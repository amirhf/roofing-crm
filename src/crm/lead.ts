import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import contractLock from "../../contracts/contract-lock.json";
import leadSchema from "../../contracts/crm-lead-v1.schema.json";

export const CRM_LEAD_STATUSES = [
  "new",
  "qualified",
  "contacted",
  "won",
  "lost",
] as const;
export type CrmLeadStatus = (typeof CRM_LEAD_STATUSES)[number];

export const ACTIVE_CRM_LEAD_CONTRACT_VERSION = "1.1.0" as const;
export const ACTIVE_ORACLE_CONTRACT = {
  version: "1.2.0",
  hash: contractLock.mcpSchema.sha256,
} as const;

export type SupportedOracleContractVersion = "1.0.0" | "1.1.0" | "1.2.0";

const SUPPORTED_ORACLE_CONTRACT_HASHES: Readonly<
  Record<SupportedOracleContractVersion, string>
> = {
  "1.0.0": "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
  "1.1.0": "1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5",
  "1.2.0": contractLock.mcpSchema.sha256,
};

export interface CrmLead {
  readonly contractVersion: typeof ACTIVE_CRM_LEAD_CONTRACT_VERSION;
  readonly leadId: string;
  readonly sessionIdHash: `sha256:${string}`;
  readonly oracleReferenceKey: `leadref_${string}`;
  readonly oracleContractVersion: SupportedOracleContractVersion;
  readonly oracleContractHash: string;
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

export function isSupportedOracleContractPair(
  version: SupportedOracleContractVersion,
  hash: string,
): boolean {
  return SUPPORTED_ORACLE_CONTRACT_HASHES[version] === hash;
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
