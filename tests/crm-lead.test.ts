import { describe, expect, it } from "vitest";

import {
  assertValidCrmLead,
  CrmLeadValidationError,
  parseCrmLead,
} from "../src/crm/lead";

const validLead = {
  contractVersion: "1.0.0",
  leadId: "2479b563-4c3f-4fd1-9340-e6f13bb97724",
  sessionIdHash: `sha256:${"a".repeat(64)}`,
  oracleReferenceKey: `leadref_${"b".repeat(32)}`,
  oracleContractVersion: "1.0.0",
  oracleSchemaHash: "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
  propertyId: `prop_${"c".repeat(32)}`,
  permitId: null,
  sourcePublicationCid: null,
  sourceCapturedAt: "2026-08-28T00:00:00Z",
  status: "new",
  notes: "",
  createdAt: "2026-08-28T00:00:00Z",
  updatedAt: "2026-08-28T00:00:00Z",
  sessionExpiresAt: "2026-09-04T00:00:00Z",
} as const;

describe("CRM lead domain", () => {
  it("accepts the normative lead shape", () => {
    expect(parseCrmLead(validLead)).toEqual(validLead);
  });

  it("rejects an unsupported lifecycle status", () => {
    expect(() => assertValidCrmLead({ ...validLead, status: "archived" })).toThrow(
      CrmLeadValidationError,
    );
  });

  it("rejects unexpected CRM-owned fields", () => {
    expect(() => assertValidCrmLead({ ...validLead, ownerPhone: "555-0100" })).toThrow(
      CrmLeadValidationError,
    );
  });
});
