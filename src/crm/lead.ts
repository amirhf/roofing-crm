import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import leadSchema from "../../contracts/crm-lead-v1.schema.json";

export const CRM_LEAD_STATUSES = [
  "new",
  "qualified",
  "contacted",
  "won",
  "lost",
] as const;
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

export interface CrmLead {
  readonly contractVersion: "1.0.0";
  readonly leadId: string;
  readonly sessionIdHash: `sha256:${string}`;
  readonly oracleReferenceKey: `leadref_${string}`;
  readonly oracleContractVersion: "1.0.0";
  readonly oracleSchemaHash: string;
  readonly propertyId: `prop_${string}`;
  readonly permitId: `perm_${string}` | null;
  readonly sourcePublicationCid: string | null;
  readonly sourceCapturedAt: string;
  readonly status: CrmLeadStatus;
  readonly notes: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sessionExpiresAt: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validateLead = ajv.compile(leadSchema);

export class CrmLeadValidationError extends Error {
  readonly validationErrors: readonly ErrorObject[];

  constructor(errors: readonly ErrorObject[]) {
    const detail = errors
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    super(`CRM lead validation failed${detail ? `: ${detail}` : "."}`);
    this.name = "CrmLeadValidationError";
    this.validationErrors = errors;
  }
}

export function assertValidCrmLead(value: unknown): asserts value is CrmLead {
  if (!validateLead(value)) {
    throw new CrmLeadValidationError(
      validateLead.errors ? structuredClone(validateLead.errors) : [],
    );
  }
}

export function parseCrmLead(value: unknown): CrmLead {
  assertValidCrmLead(value);
  return value;
}
