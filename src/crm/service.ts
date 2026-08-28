import { createHash, randomUUID } from "node:crypto";

import { CRM_LEAD_STATUSES, assertValidCrmLead, type CrmLead } from "./lead";
import type { LeadRepository } from "./repository";

const PROPERTY_ID = /^prop_[a-f0-9]{32}$/;
const PERMIT_ID = /^perm_[a-f0-9]{32}$/;
const SCHEMA_HASH = /^[a-f0-9]{64}$/;

export interface CreateLeadInput {
  readonly propertyId: CrmLead["propertyId"];
  readonly permitId: CrmLead["permitId"];
  readonly oracleSchemaHash: string;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateLeadInput(value: unknown): CreateLeadInput {
  if (!isObject(value)) throw new LeadInputError("request body must be an object.");
  if (!PROPERTY_ID.test(String(value.propertyId))) {
    throw new LeadInputError("propertyId is invalid.");
  }
  if (value.permitId !== null && !PERMIT_ID.test(String(value.permitId))) {
    throw new LeadInputError("permitId is invalid.");
  }
  if (!SCHEMA_HASH.test(String(value.oracleSchemaHash))) {
    throw new LeadInputError("oracleSchemaHash is invalid.");
  }
  if (
    value.sourcePublicationCid !== null &&
    typeof value.sourcePublicationCid !== "string"
  ) {
    throw new LeadInputError("sourcePublicationCid must be a string or null.");
  }
  if (
    typeof value.sourceCapturedAt !== "string" ||
    Number.isNaN(Date.parse(value.sourceCapturedAt))
  ) {
    throw new LeadInputError("sourceCapturedAt must be a date-time.");
  }
  return value as unknown as CreateLeadInput;
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
    .update(`${input.propertyId}|${input.permitId ?? ""}|${input.oracleSchemaHash}`)
    .digest("hex")
    .slice(0, 32);
  return `leadref_${hash}`;
}

export async function createLead(
  repository: LeadRepository,
  sessionIdHash: CrmLead["sessionIdHash"],
  sessionExpiresAt: string,
  input: CreateLeadInput,
  now = new Date(),
): Promise<CrmLead> {
  const timestamp = now.toISOString();
  const lead: CrmLead = {
    contractVersion: "1.0.0",
    leadId: randomUUID(),
    sessionIdHash,
    oracleReferenceKey: referenceKey(input),
    oracleContractVersion: "1.0.0",
    oracleSchemaHash: input.oracleSchemaHash,
    propertyId: input.propertyId,
    permitId: input.permitId,
    sourcePublicationCid: input.sourcePublicationCid,
    sourceCapturedAt: new Date(input.sourceCapturedAt).toISOString(),
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
