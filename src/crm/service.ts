import { createHash, randomUUID } from "node:crypto";

import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import type {
  Evidence,
  OracleCallOptions,
  OracleClient,
  OracleFailure,
  OracleResponseMeta,
} from "@/oracle/types";

import {
  ACTIVE_CRM_LEAD_CONTRACT_VERSION,
  ACTIVE_ORACLE_CONTRACT,
  CRM_LEAD_STATUSES,
  assertValidCrmLead,
  isSupportedOracleContractPair,
  type CrmLead,
  type SupportedOracleContractVersion,
} from "./lead";
import type { LeadRepository } from "./repository";

const PROPERTY_ID = /^prop_[a-f0-9]{32}$/;
const PERMIT_ID = /^perm_[a-f0-9]{32}$/;
const CREATE_LEAD_FIELDS = new Set(["propertyId", "permitId"]);

export interface CreateLeadInput {
  readonly propertyId: CrmLead["propertyId"];
  readonly permitId: CrmLead["permitId"];
}

export interface OracleLeadProvenance {
  readonly oracleContractVersion: SupportedOracleContractVersion;
  readonly oracleContractHash: string;
  readonly sourcePublicationCid: string | null;
  readonly sourceCapturedAt: string;
}

export interface UpdateLeadInput {
  readonly status: CrmLead["status"];
  readonly notes: string;
}

export class LeadInputError extends Error {
  constructor(message: string) {
    super(`Lead input error: ${message}`);
    this.name = "LeadInputError";
  }
}

export class LeadOracleProvenanceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Lead Oracle provenance error: ${message}`, options);
    this.name = "LeadOracleProvenanceError";
  }
}

export class LeadOracleUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Oracle MCP could not validate the lead source record.", options);
    this.name = "LeadOracleUnavailableError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateLeadInput(value: unknown): CreateLeadInput {
  if (!isObject(value)) throw new LeadInputError("request body must be an object.");
  const unexpectedField = Object.keys(value).find(
    (field) => !CREATE_LEAD_FIELDS.has(field),
  );
  if (unexpectedField) {
    throw new LeadInputError(`unexpected field ${unexpectedField}.`);
  }
  if (!PROPERTY_ID.test(String(value.propertyId))) {
    throw new LeadInputError("propertyId is invalid.");
  }
  if (value.permitId !== null && !PERMIT_ID.test(String(value.permitId))) {
    throw new LeadInputError("permitId is invalid.");
  }
  return {
    propertyId: value.propertyId as CrmLead["propertyId"],
    permitId: value.permitId as CrmLead["permitId"],
  };
}

export function parseUpdateLeadInput(value: unknown): UpdateLeadInput {
  if (!isObject(value)) throw new LeadInputError("request body must be an object.");
  if (!CRM_LEAD_STATUSES.includes(value.status as CrmLead["status"])) {
    throw new LeadInputError("status is invalid.");
  }
  if (typeof value.notes !== "string" || value.notes.length > 10_000) {
    throw new LeadInputError("notes must contain at most 10000 characters.");
  }
  return { status: value.status as CrmLead["status"], notes: value.notes };
}

function referenceKey(input: CreateLeadInput): CrmLead["oracleReferenceKey"] {
  const hash = createHash("sha256")
    .update(`${input.propertyId}|${input.permitId ?? ""}`)
    .digest("hex")
    .slice(0, 32);
  return `leadref_${hash}`;
}

function assertActiveOracleMeta(meta: OracleResponseMeta): void {
  if (
    meta.contractVersion !== ACTIVE_ORACLE_CONTRACT.version ||
    meta.schemaHash !== ACTIVE_ORACLE_CONTRACT.hash
  ) {
    throw new LeadOracleProvenanceError(
      "the validated response did not use the active Oracle contract pair.",
    );
  }
}

function oracleFailure(error: OracleFailure): never {
  if (error.error.code === "not_found" || error.error.code === "invalid_argument") {
    throw new LeadOracleProvenanceError(error.error.message);
  }
  throw new LeadOracleUnavailableError({ cause: new Error(error.error.message) });
}

function publicationCid(
  meta: OracleResponseMeta,
  evidence: readonly Evidence[],
): string | null {
  return (
    meta.artifactCids.find((value) => value.length > 0) ??
    evidence.find((item) => item.publishedCid)?.publishedCid ??
    null
  );
}

function provenanceCallOptions(
  options?: OracleCallOptions,
): OracleCallOptions | undefined {
  if (!options?.timeoutMs) return options;
  const deadlineSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  return { ...options, signal };
}

export async function resolveLeadOracleProvenance(
  oracle: OracleClient,
  input: CreateLeadInput,
  options?: OracleCallOptions,
): Promise<OracleLeadProvenance> {
  try {
    const callOptions = provenanceCallOptions(options);
    const propertyResult = await oracle.getProperty(
      { propertyId: input.propertyId },
      callOptions,
    );
    if (!propertyResult.ok) oracleFailure(propertyResult);
    if (propertyResult.data.propertyId !== input.propertyId) {
      throw new LeadOracleProvenanceError(
        "the returned property identifier did not match the requested property.",
      );
    }
    assertActiveOracleMeta(propertyResult.meta);

    const evidence = [...propertyResult.data.evidence];
    if (input.permitId) {
      const permitResult = await oracle.getPermit(
        { permitId: input.permitId },
        callOptions,
      );
      if (!permitResult.ok) oracleFailure(permitResult);
      if (
        permitResult.data.permitId !== input.permitId ||
        permitResult.data.propertyId !== input.propertyId
      ) {
        throw new LeadOracleProvenanceError(
          "the returned permit did not belong to the requested property.",
        );
      }
      assertActiveOracleMeta(permitResult.meta);
      evidence.push(...permitResult.data.evidence);
    }

    return {
      oracleContractVersion: propertyResult.meta.contractVersion,
      oracleContractHash: propertyResult.meta.schemaHash,
      sourcePublicationCid: publicationCid(propertyResult.meta, evidence),
      sourceCapturedAt: propertyResult.meta.asOf,
    };
  } catch (error) {
    if (
      error instanceof LeadOracleProvenanceError ||
      error instanceof LeadOracleUnavailableError
    ) {
      throw error;
    }
    if (
      error instanceof ContractValidationError ||
      error instanceof OracleSchemaHashMismatchError
    ) {
      throw new LeadOracleProvenanceError("the MCP response failed validation.", {
        cause: error,
      });
    }
    throw new LeadOracleUnavailableError({ cause: error });
  }
}

export async function createLead(
  repository: LeadRepository,
  sessionIdHash: CrmLead["sessionIdHash"],
  sessionExpiresAt: string,
  input: CreateLeadInput,
  provenance: OracleLeadProvenance,
  now = new Date(),
): Promise<CrmLead> {
  if (
    !isSupportedOracleContractPair(
      provenance.oracleContractVersion,
      provenance.oracleContractHash,
    ) ||
    provenance.oracleContractVersion !== ACTIVE_ORACLE_CONTRACT.version ||
    provenance.oracleContractHash !== ACTIVE_ORACLE_CONTRACT.hash
  ) {
    throw new LeadOracleProvenanceError(
      "new leads require the active Oracle contract version and hash pair.",
    );
  }
  const timestamp = now.toISOString();
  const lead: CrmLead = {
    contractVersion: ACTIVE_CRM_LEAD_CONTRACT_VERSION,
    leadId: randomUUID(),
    sessionIdHash,
    oracleReferenceKey: referenceKey(input),
    oracleContractVersion: provenance.oracleContractVersion,
    oracleContractHash: provenance.oracleContractHash,
    propertyId: input.propertyId,
    permitId: input.permitId,
    sourcePublicationCid: provenance.sourcePublicationCid,
    sourceCapturedAt: new Date(provenance.sourceCapturedAt).toISOString(),
    status: "new",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    sessionExpiresAt,
  };
  assertValidCrmLead(lead);
  return repository.create(lead);
}

export async function updateLead(
  repository: LeadRepository,
  sessionIdHash: CrmLead["sessionIdHash"],
  leadId: string,
  input: UpdateLeadInput,
  now = new Date(),
): Promise<CrmLead | null> {
  return repository.update(
    sessionIdHash,
    leadId,
    { ...input, updatedAt: now.toISOString() },
    now,
  );
}
