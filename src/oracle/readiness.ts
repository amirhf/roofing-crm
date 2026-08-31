import "server-only";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import contractLock from "../../contracts/contract-lock.json";
import mcpSchema from "../../contracts/mcp-v1.schema.json";
import type { OracleRuntimeConfig } from "@/config/oracle";

import { EXPECTED_MCP_SCHEMA_SHA256 } from "./contracts";
import { createOracleClient } from "./factory";
import {
  ORACLE_MCP_TOOL_NAMES,
  type JsonObject,
  type OracleClient,
  type OracleMcpToolDescriptor,
  type OracleResult,
} from "./types";

export const ORACLE_READINESS_TTL_MS = 30_000;

export type OracleCoverageStatus = "available" | "partial" | "unavailable";

export interface OracleReadinessSnapshot {
  readonly ready: true;
  readonly checkedAt: string;
  readonly contractVersion: "1.2.0";
  readonly schemaHash: string;
  readonly tools: typeof ORACLE_MCP_TOOL_NAMES;
  readonly publication: Readonly<{
    label: string;
    recordCount: number;
    authoritativeComplete: false;
    publicationStatus:
      "not_generated" | "dry_run_validated" | "published" | "unavailable";
    datasetFreshness: string;
    coordinatesAvailable: number;
    coordinatesUnavailable: number;
    roofSignalsDirect: number;
    roofSignalsProxy: number;
    permits: OracleCoverageStatus;
    contractors: OracleCoverageStatus;
  }>;
}

export class OracleReadinessError extends Error {
  readonly stage: string;

  constructor(stage = "metadata", options?: ErrorOptions) {
    super(`Oracle readiness validation failed at ${stage}.`, options);
    this.name = "OracleReadinessError";
    this.stage = stage;
  }
}

async function atReadinessStage<T>(
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OracleReadinessError) throw error;
    throw new OracleReadinessError(stage, { cause: error });
  }
}

export function oracleReadinessStage(error: unknown): string | undefined {
  if (!(error instanceof OracleReadinessError)) return undefined;
  return /^[a-z][a-z0-9_]{0,63}$/.test(error.stage)
    ? error.stage
    : "readiness_validation";
}

interface CacheEntry {
  expiresAt: number | null;
  readonly promise: Promise<OracleReadinessSnapshot>;
}

const readinessCache = new Map<string, CacheEntry>();

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Readiness wait aborted.", "AbortError");
}

async function awaitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

const TOOL_SCHEMA_DEFINITIONS = [
  ["prism_v1_get_service_info", "ServiceInfoArguments", "ServiceInfoSuccessResult"],
  [
    "prism_v1_get_pipeline_run_summary",
    "PipelineRunSummaryArguments",
    "PipelineRunSummarySuccessResult",
  ],
  ["prism_v1_search_roofing_opportunities", "SearchArguments", "SearchSuccessResult"],
  ["prism_v1_get_property", "PropertyArguments", "PropertySuccessResult"],
  ["prism_v1_get_permit", "PermitArguments", "PermitSuccessResult"],
  ["prism_v1_get_query_schema", "QuerySchemaArguments", "QuerySchemaSuccessResult"],
] as const;

const INPUT_PROBES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  prism_v1_get_service_info: {},
  prism_v1_get_pipeline_run_summary: {},
  prism_v1_search_roofing_opportunities: {
    county: "pasco",
    center: { kind: "coordinates", latitude: 28.3, longitude: -82.4 },
    radius: { value: 1, unit: "mi" },
    filters: {},
    sort: "distance_asc",
    page: { limit: 1 },
  },
  prism_v1_get_property: { propertyId: `prop_${"0".repeat(32)}` },
  prism_v1_get_permit: { permitId: `perm_${"0".repeat(32)}` },
  prism_v1_get_query_schema: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const SCHEMA_ANNOTATIONS = new Set([
  "$comment",
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

function normalizedSchema(
  value: unknown,
  definitions: Readonly<Record<string, unknown>>,
  resolving: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizedSchema(item, definitions, resolving));
  }
  if (!isRecord(value)) return value;
  const reference = value.$ref;
  if (typeof reference === "string" && reference.startsWith("#/$defs/")) {
    const name = reference.slice("#/$defs/".length);
    const target = definitions[name];
    if (target === undefined) return { $ref: reference };
    if (resolving.has(name)) return { $ref: reference };
    return normalizedSchema(target, definitions, new Set([...resolving, name]));
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$defs" && !SCHEMA_ANNOTATIONS.has(key))
      .map(([key, child]) => [key, normalizedSchema(child, definitions, resolving)]),
  );
}

function exactSchemaShape(
  schema: Readonly<Record<string, unknown>>,
  expectedDefinition: string,
): boolean {
  const advertisedDefinitions = isRecord(schema.$defs) ? schema.$defs : {};
  const expectedDefinitions = mcpSchema.$defs as Readonly<Record<string, unknown>>;
  const expected = expectedDefinitions[expectedDefinition];
  return (
    expected !== undefined &&
    canonical(normalizedSchema(schema, advertisedDefinitions)) ===
      canonical(normalizedSchema(expected, expectedDefinitions))
  );
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function resolvedRoot(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const reference = schema.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/$defs/")) {
    return schema;
  }
  const definitions = isRecord(schema.$defs)
    ? schema.$defs
    : (mcpSchema.$defs as Readonly<Record<string, unknown>>);
  const definition = definitions[reference.slice("#/$defs/".length)];
  return isRecord(definition) ? definition : null;
}

function rootShape(schema: Readonly<Record<string, unknown>>): Readonly<{
  required: readonly string[];
  properties: readonly string[];
}> | null {
  const root = resolvedRoot(schema);
  if (root === null) return null;
  const required = root.required === undefined ? [] : stringArray(root.required);
  const properties =
    root.properties === undefined
      ? []
      : isRecord(root.properties)
        ? Object.keys(root.properties).sort()
        : null;
  if (
    root.type !== "object" ||
    root.additionalProperties !== false ||
    required === null ||
    properties === null
  ) {
    return null;
  }
  return { required: [...required].sort(), properties };
}

function expectedRootShape(definition: string) {
  const definitions = mcpSchema.$defs as Readonly<Record<string, unknown>>;
  const schema = definitions[definition];
  return isRecord(schema) ? rootShape(schema) : null;
}

function compileSchema(schema: Readonly<Record<string, unknown>>) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

export function assertCompatibleOracleTools(
  tools: readonly OracleMcpToolDescriptor[],
): void {
  if (
    !stringsEqual(
      tools.map((tool) => tool.name),
      ORACLE_MCP_TOOL_NAMES,
    )
  ) {
    throw new OracleReadinessError("tool_order");
  }

  for (const [
    index,
    [, inputDefinition, outputDefinition],
  ] of TOOL_SCHEMA_DEFINITIONS.entries()) {
    const descriptor = tools[index];
    if (!descriptor || descriptor.outputSchema === null) {
      throw new OracleReadinessError("tool_output_schema_missing");
    }
    const inputShape = rootShape(descriptor.inputSchema);
    const outputShape = rootShape(descriptor.outputSchema);
    const expectedInput = expectedRootShape(inputDefinition);
    const expectedOutput = expectedRootShape(outputDefinition);
    if (
      inputShape === null ||
      outputShape === null ||
      expectedInput === null ||
      expectedOutput === null ||
      !stringsEqual(inputShape.required, expectedInput.required) ||
      !stringsEqual(inputShape.properties, expectedInput.properties) ||
      !stringsEqual(outputShape.required, expectedOutput.required) ||
      !stringsEqual(outputShape.properties, expectedOutput.properties) ||
      !exactSchemaShape(descriptor.inputSchema, inputDefinition) ||
      !exactSchemaShape(descriptor.outputSchema, outputDefinition)
    ) {
      throw new OracleReadinessError(`tool_schema_shape_${index}`);
    }

    let validateInput;
    let validateOutput;
    try {
      validateInput = compileSchema(descriptor.inputSchema);
      validateOutput = compileSchema(descriptor.outputSchema);
    } catch {
      throw new OracleReadinessError(`tool_schema_compile_${index}`);
    }
    const inputProbe = INPUT_PROBES[descriptor.name];
    if (!inputProbe || !validateInput(inputProbe)) {
      throw new OracleReadinessError(`tool_input_probe_${index}`);
    }
    if (validateInput({ ...inputProbe, unexpected: true })) {
      throw new OracleReadinessError(`tool_input_strict_${index}`);
    }
    if (validateOutput({ ok: true, data: {}, meta: {}, unexpected: true })) {
      throw new OracleReadinessError(`tool_output_strict_${index}`);
    }
  }
}

function requireSuccess(
  result: OracleResult<JsonObject>,
): Readonly<Record<string, unknown>> {
  if (!result.ok || !isRecord(result.data)) throw new OracleReadinessError();
  return result.data;
}

function requireRecord(parent: Readonly<Record<string, unknown>>, key: string) {
  const value = parent[key];
  if (!isRecord(value)) throw new OracleReadinessError();
  return value;
}

function requireNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OracleReadinessError();
  }
  return value as number;
}

function coverageStatus(value: unknown): OracleCoverageStatus {
  if (value === "available" || value === "partial" || value === "unavailable") {
    return value;
  }
  throw new OracleReadinessError();
}

function publicationStatus(
  value: unknown,
): OracleReadinessSnapshot["publication"]["publicationStatus"] {
  if (
    value === "not_generated" ||
    value === "dry_run_validated" ||
    value === "published" ||
    value === "unavailable"
  ) {
    return value;
  }
  throw new OracleReadinessError();
}

function publicationLabel(
  status: OracleReadinessSnapshot["publication"]["publicationStatus"],
): string {
  return status === "published"
    ? "Candidate-owned published dataset"
    : status === "dry_run_validated"
      ? "Candidate-owned validated sample"
      : "Candidate-owned dataset with unavailable publication status";
}

async function probeReadiness(
  config: OracleRuntimeConfig,
  client: OracleClient,
  requestSignal?: AbortSignal,
): Promise<OracleReadinessSnapshot> {
  if (!client.discoverTools) throw new OracleReadinessError();
  const timeoutSignal = AbortSignal.timeout(config.oracleMcpTimeoutMs);
  const options = {
    signal: requestSignal
      ? AbortSignal.any([requestSignal, timeoutSignal])
      : timeoutSignal,
    timeoutMs: config.oracleMcpTimeoutMs,
  } as const;
  const tools = await atReadinessStage("tool_discovery", () =>
    client.discoverTools!(options),
  );
  assertCompatibleOracleTools(tools);

  const [serviceResult, pipelineResult, querySchemaResult] = await Promise.all([
    atReadinessStage("service_info", () => client.getServiceInfo(options)),
    atReadinessStage("pipeline_summary", () => client.getPipelineRunSummary({}, options)),
    atReadinessStage("query_schema", () => client.getQuerySchema(options)),
  ]);
  const service = requireSuccess(serviceResult);
  const pipeline = requireSuccess(pipelineResult);
  requireSuccess(querySchemaResult);
  if (
    service.contractVersion !== contractLock.contractVersion ||
    service.activeContractHash !== EXPECTED_MCP_SCHEMA_SHA256 ||
    service.county !== "pasco" ||
    !stringsEqual(stringArray(service.supportedTools) ?? [], ORACLE_MCP_TOOL_NAMES)
  ) {
    throw new OracleReadinessError();
  }

  const dataset = requireRecord(service, "dataset");
  const freshness = requireRecord(dataset, "freshness");
  const coverage = requireRecord(pipeline, "coverage");
  const properties = requireRecord(coverage, "properties");
  const coordinates = requireRecord(coverage, "coordinates");
  const roofSignals = requireRecord(coverage, "roofSignals");
  const permits = requireRecord(coverage, "permits");
  const contractors = requireRecord(coverage, "contractors");
  const publicationArtifacts = requireRecord(pipeline, "publicationArtifacts");
  const status = publicationStatus(publicationArtifacts.status);
  const datasetFreshness =
    typeof freshness.publishedAt === "string"
      ? freshness.publishedAt
      : typeof freshness.loadedAt === "string"
        ? freshness.loadedAt
        : null;
  const propertyCount = requireNonnegativeInteger(properties.available);
  const propertyUnavailable = requireNonnegativeInteger(properties.unavailable);
  const coordinateAvailable = requireNonnegativeInteger(coordinates.available);
  const coordinateUnavailable = requireNonnegativeInteger(coordinates.unavailable);
  const roofAvailable = requireNonnegativeInteger(roofSignals.available);
  const roofUnavailable = requireNonnegativeInteger(roofSignals.unavailable);
  const roofDirect = requireNonnegativeInteger(roofSignals.direct);
  const roofProxy = requireNonnegativeInteger(roofSignals.proxy);
  const datasetVersion = dataset.version;
  if (
    datasetFreshness === null ||
    (status !== "published" && status !== "dry_run_validated") ||
    typeof datasetVersion !== "string" ||
    datasetVersion !== publicationArtifacts.datasetVersion ||
    propertyUnavailable !== 0 ||
    coordinateAvailable + coordinateUnavailable !== propertyCount ||
    roofAvailable + roofUnavailable !== propertyCount ||
    roofDirect + roofProxy !== roofAvailable
  ) {
    throw new OracleReadinessError("publication_metadata");
  }

  return {
    ready: true,
    checkedAt: new Date().toISOString(),
    contractVersion: "1.2.0",
    schemaHash: EXPECTED_MCP_SCHEMA_SHA256,
    tools: ORACLE_MCP_TOOL_NAMES,
    publication: {
      label: publicationLabel(status),
      recordCount: propertyCount,
      authoritativeComplete: false,
      publicationStatus: status,
      datasetFreshness,
      coordinatesAvailable: coordinateAvailable,
      coordinatesUnavailable: coordinateUnavailable,
      roofSignalsDirect: roofDirect,
      roofSignalsProxy: roofProxy,
      permits: coverageStatus(permits.status),
      contractors: coverageStatus(contractors.status),
    },
  };
}

function cacheKey(config: OracleRuntimeConfig): string {
  return [
    config.nodeEnvironment,
    config.dataSource,
    config.oracleMcpUrl?.toString() ?? "fixture",
    config.oracleMcpTimeoutMs,
  ].join("|");
}

export async function ensureOracleReadiness(
  config: OracleRuntimeConfig,
  client: OracleClient = createOracleClient(config),
  requestSignal?: AbortSignal,
): Promise<OracleReadinessSnapshot> {
  const key = cacheKey(config);
  const now = Date.now();
  const cached = readinessCache.get(key);
  if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
    return awaitForCaller(cached.promise, requestSignal);
  }

  const promise = probeReadiness(config, client)
    .then((snapshot) => {
      const current = readinessCache.get(key);
      if (current?.promise === promise) {
        current.expiresAt = Date.now() + ORACLE_READINESS_TTL_MS;
      }
      return snapshot;
    })
    .catch((error: unknown) => {
      if (readinessCache.get(key)?.promise === promise) readinessCache.delete(key);
      if (error instanceof OracleReadinessError) throw error;
      throw new OracleReadinessError("metadata", { cause: error });
    });
  const entry: CacheEntry = { expiresAt: null, promise };
  readinessCache.set(key, entry);
  return awaitForCaller(promise, requestSignal);
}

export function resetOracleReadinessForTests(): void {
  readinessCache.clear();
}
