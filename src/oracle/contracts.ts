import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import contractLock from "../../contracts/contract-lock.json";
import mcpSchema from "../../contracts/mcp-v1.schema.json";
import type {
  NodeEnvironment,
  OracleMcpToolName,
  OracleResult,
  SearchArguments,
} from "./types";

const MCP_SCHEMA_ID = "https://schemas.prismteam.ai/oracle/mcp/v1/schema.json";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
  validateFormats: true,
});
addFormats(ajv);
ajv.addSchema(mcpSchema);

function requireValidator(reference: string): ValidateFunction {
  const validator = ajv.getSchema(reference);
  if (!validator) {
    throw new Error(`Contract validator was not compiled for ${reference}.`);
  }
  return validator;
}

const validateFixture = requireValidator(MCP_SCHEMA_ID);
const validateSearchArguments = requireValidator(
  `${MCP_SCHEMA_ID}#/$defs/SearchArguments`,
);

export const EXPECTED_MCP_SCHEMA_SHA256 = contractLock.mcpSchema.sha256;

export class ContractValidationError extends Error {
  readonly validationErrors: readonly ErrorObject[];

  constructor(scope: string, errors: readonly ErrorObject[] = []) {
    const detail = errors
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    super(
      `Oracle contract validation failed for ${scope}${detail ? `: ${detail}` : "."}`,
    );
    this.name = "ContractValidationError";
    this.validationErrors = errors;
  }
}

export class OracleSchemaHashMismatchError extends Error {
  constructor(actual: unknown) {
    super(
      `Oracle schema hash mismatch: expected ${EXPECTED_MCP_SCHEMA_SHA256}, received ${String(actual)}.`,
    );
    this.name = "OracleSchemaHashMismatchError";
  }
}

export class ProductionFixtureDataError extends Error {
  constructor(path: string) {
    super(`Production rejected Oracle fixture data at ${path}.`);
    this.name = "ProductionFixtureDataError";
  }
}

function cloneErrors(errors: ValidateFunction["errors"]): readonly ErrorObject[] {
  return errors ? structuredClone(errors) : [];
}

export function assertValidMcpFixture(value: unknown): void {
  if (!validateFixture(value)) {
    throw new ContractValidationError(
      "frozen MCP fixture",
      cloneErrors(validateFixture.errors),
    );
  }
  assertOwnershipSemantics(value, "frozen MCP fixture");
}

export function assertValidSearchArguments(
  value: unknown,
): asserts value is SearchArguments {
  if (!validateSearchArguments(value)) {
    throw new ContractValidationError(
      "prism_v1_search_roofing_opportunities input",
      cloneErrors(validateSearchArguments.errors),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticError(instancePath: string, keyword: string): ErrorObject {
  return {
    instancePath,
    schemaPath: `#/$semantic/${keyword}`,
    keyword,
    params: {},
    message: "violates the MCP ownership publication semantics",
  };
}

function propertyRecords(
  value: unknown,
): Array<{ path: string; property: Record<string, unknown> }> {
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.data)) {
    return [];
  }
  if (value.fixtureType === "property-response") {
    return [{ path: "/result/data", property: value.result.data }];
  }
  if (value.fixtureType !== "search-response") return [];
  const opportunities = value.result.data.opportunities;
  if (!Array.isArray(opportunities)) return [];
  return opportunities.flatMap((opportunity, index) =>
    isRecord(opportunity) && isRecord(opportunity.property)
      ? [
          {
            path: `/result/data/opportunities/${index}/property`,
            property: opportunity.property,
          },
        ]
      : [],
  );
}

function ownershipSemanticErrors(value: unknown): ErrorObject[] {
  const errors: ErrorObject[] = [];
  for (const { path, property } of propertyRecords(value)) {
    if (!isRecord(property.ownership)) continue;
    const evidenceIds = new Set(
      Array.isArray(property.evidence)
        ? property.evidence.flatMap((evidence) =>
            isRecord(evidence) && typeof evidence.evidenceId === "string"
              ? [evidence.evidenceId]
              : [],
          )
        : [],
    );
    const visit = (entry: unknown, entryPath: string): void => {
      if (Array.isArray(entry)) {
        entry.forEach((child, index) => visit(child, `${entryPath}/${index}`));
        return;
      }
      if (!isRecord(entry)) return;
      if (Array.isArray(entry.evidenceRefs)) {
        for (const reference of entry.evidenceRefs) {
          if (typeof reference === "string" && !evidenceIds.has(reference)) {
            errors.push(semanticError(`${entryPath}/evidenceRefs`, "evidenceReference"));
            break;
          }
        }
      }
      Object.entries(entry).forEach(([key, child]) =>
        visit(child, `${entryPath}/${key}`),
      );
    };
    visit(property.ownership, `${path}/ownership`);
  }
  return errors;
}

function assertOwnershipSemantics(value: unknown, scope: string): void {
  const errors = ownershipSemanticErrors(value);
  if (errors.length > 0) throw new ContractValidationError(scope, errors);
}

function fixtureTypeFor(tool: OracleMcpToolName): string | undefined {
  switch (tool) {
    case "prism_v1_get_service_info":
      return "service-info-response";
    case "prism_v1_get_pipeline_run_summary":
      return "pipeline-run-summary-response";
    case "prism_v1_search_roofing_opportunities":
      return "search-response";
    case "prism_v1_get_property":
      return "property-response";
    case "prism_v1_get_permit":
      return "permit-response";
    case "prism_v1_get_query_schema":
      return "query-schema-response";
  }
}

function assertCommonResponse(tool: OracleMcpToolName, value: unknown): void {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !isRecord(value.meta)) {
    throw new ContractValidationError(`${tool} response envelope`);
  }
  if (value.meta.contractVersion !== contractLock.contractVersion) {
    throw new ContractValidationError(`${tool} contract version`);
  }
  if (value.ok && !("data" in value)) {
    throw new ContractValidationError(`${tool} success data`);
  }
}

function assertExpectedSchemaHash(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.meta)) {
    throw new ContractValidationError("Oracle response metadata");
  }
  if (value.meta.schemaHash !== EXPECTED_MCP_SCHEMA_SHA256) {
    throw new OracleSchemaHashMismatchError(value.meta.schemaHash);
  }
}

const FROZEN_FIXTURE_IDENTIFIERS = new Set([
  "prop_e72ba795455c19d71ce4cb11f6177a5e",
  "perm_91699de8cc4d322ad6fb183f20ae349e",
  "ev_fixture_appraiser_001",
  "ev_fixture_permit_001",
  "req_fixture_001",
]);

function assertNoFixtureMarkers(value: unknown, path = "$", key?: string): void {
  if (typeof value === "string") {
    const isFixture =
      value.startsWith("fixture://") ||
      value.startsWith("FIXTURE-") ||
      FROZEN_FIXTURE_IDENTIFIERS.has(value) ||
      (key === "sourceSystem" && value.toLowerCase() === "fixture");
    if (isFixture) {
      throw new ProductionFixtureDataError(path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFixtureMarkers(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([childKey, childValue]) =>
      assertNoFixtureMarkers(childValue, `${path}.${childKey}`, childKey),
    );
  }
}

export function validateOracleToolResult<T>(
  tool: OracleMcpToolName,
  value: unknown,
  nodeEnvironment: NodeEnvironment,
): OracleResult<T> {
  assertCommonResponse(tool, value);
  const valueRecord = value as Record<string, unknown>;
  const isError = valueRecord.ok === false;
  const fixtureType = isError ? "error-response" : fixtureTypeFor(tool);

  if (fixtureType) {
    const wrapper = { fixtureType, tool, result: value };
    if (!validateFixture(wrapper)) {
      throw new ContractValidationError(
        `${tool} response`,
        cloneErrors(validateFixture.errors),
      );
    }
    assertOwnershipSemantics(wrapper, `${tool} response`);
  }

  assertExpectedSchemaHash(value);
  if (nodeEnvironment === "production") {
    assertNoFixtureMarkers(value);
  }
  return value as OracleResult<T>;
}
