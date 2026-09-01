import { describe, expect, it } from "vitest";

import {
  assertValidCrmLead,
  CrmLeadValidationError,
  parseCrmLead,
} from "../src/crm/lead";

const validLead = {
  contractVersion: "1.1.0",
  leadId: "2479b563-4c3f-4fd1-9340-e6f13bb97724",
  sessionIdHash: `sha256:${"a".repeat(64)}`,
  oracleReferenceKey: `leadref_${"b".repeat(32)}`,
  oracleContractVersion: "1.2.0",
  oracleContractHash: "9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131",
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

  it.each([
    ["1.0.0", "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7"],
    ["1.1.0", "1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5"],
  ] as const)(
    "accepts a historical Oracle %s provenance pair in the active lead shape",
    (oracleContractVersion, oracleContractHash) => {
      expect(() =>
        assertValidCrmLead({
          ...validLead,
          oracleContractVersion,
          oracleContractHash,
        }),
      ).not.toThrow();
    },
  );

  it("rejects a mismatched Oracle contract version and hash", () => {
    expect(() =>
      assertValidCrmLead({
        ...validLead,
        oracleContractHash:
          "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
      }),
    ).toThrow(CrmLeadValidationError);
  });

  it("rejects the superseded oracleSchemaHash field on an active lead", () => {
    const withoutContractHash: Record<string, unknown> = { ...validLead };
    delete withoutContractHash.oracleContractHash;
    expect(() =>
      assertValidCrmLead({
        ...withoutContractHash,
        oracleSchemaHash:
          "9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131",
      }),
    ).toThrow(CrmLeadValidationError);
  });
});
