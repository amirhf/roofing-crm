import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import contractLock from "../contracts/contract-lock.json";
import errorFixture from "../contracts/fixtures/error-response.json";
import permitRequestFixture from "../contracts/fixtures/permit-request.json";
import permitFixture from "../contracts/fixtures/permit-response.json";
import pipelineRunSummaryRequestFixture from "../contracts/fixtures/pipeline-run-summary-request.json";
import pipelineRunSummaryResponseFixture from "../contracts/fixtures/pipeline-run-summary-response.json";
import propertyRequestFixture from "../contracts/fixtures/property-request.json";
import propertyFixture from "../contracts/fixtures/property-response.json";
import querySchemaRequestFixture from "../contracts/fixtures/query-schema-request.json";
import querySchemaResponseFixture from "../contracts/fixtures/query-schema-response.json";
import searchRequestFixture from "../contracts/fixtures/search-request.json";
import searchResponseFixture from "../contracts/fixtures/search-response.json";
import serviceInfoRequestFixture from "../contracts/fixtures/service-info-request.json";
import serviceInfoResponseFixture from "../contracts/fixtures/service-info-response.json";
import {
  assertValidMcpFixture,
  ContractValidationError,
  EXPECTED_MCP_SCHEMA_SHA256,
} from "../src/oracle/contracts";

const fixtures = [
  ["error response", errorFixture],
  ["permit request", permitRequestFixture],
  ["permit response", permitFixture],
  ["pipeline run summary request", pipelineRunSummaryRequestFixture],
  ["pipeline run summary response", pipelineRunSummaryResponseFixture],
  ["property request", propertyRequestFixture],
  ["property response", propertyFixture],
  ["query schema request", querySchemaRequestFixture],
  ["query schema response", querySchemaResponseFixture],
  ["search request", searchRequestFixture],
  ["search response", searchResponseFixture],
  ["service info request", serviceInfoRequestFixture],
  ["service info response", serviceInfoResponseFixture],
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a fixture object.");
  }
  return value as Record<string, unknown>;
}

function mutablePropertyFixture() {
  const fixture: unknown = clone(propertyFixture);
  const result = record(record(fixture).result);
  const data = record(result.data);
  return { data, fixture, ownership: record(data.ownership) };
}

async function sha256(relativePath: string): Promise<string> {
  const bytes = await readFile(new URL(`../${relativePath}`, import.meta.url));
  return createHash("sha256").update(bytes).digest("hex");
}

describe("frozen MCP contract", () => {
  it.each(fixtures)("accepts the committed %s fixture", (_name, fixture) => {
    expect(() => assertValidMcpFixture(fixture)).not.toThrow();
  });

  it("rejects a search radius outside the frozen bounds", () => {
    const invalid = clone(searchRequestFixture);
    invalid.arguments.radius.value = 0;
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects an unexpected response property", () => {
    const invalid: Record<string, unknown> = clone(searchResponseFixture);
    invalid.unexpected = true;
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects a malformed property identifier", () => {
    const invalid = clone(propertyFixture);
    invalid.result.data.propertyId = "fixture-property";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects an invalid permit evidence URI", () => {
    const invalid = clone(permitFixture);
    invalid.result.data.evidence[0]!.sourceArtifactUri = "not a uri";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects an empty available current-owner list", () => {
    const { fixture, ownership } = mutablePropertyFixture();
    record(ownership.currentOwners).value = [];
    expect(() => assertValidMcpFixture(fixture)).toThrow(ContractValidationError);
  });

  it("rejects an available owner name without resolving provenance", () => {
    const { fixture, ownership } = mutablePropertyFixture();
    const owners = record(ownership.currentOwners).value;
    if (!Array.isArray(owners)) throw new TypeError("Expected owner values.");
    record(owners[0]).evidenceRefs = ["ev_missing_owner_source"];
    expect(() => assertValidMcpFixture(fixture)).toThrow(ContractValidationError);
  });

  it("rejects inferred ownership classification", () => {
    const { fixture, ownership } = mutablePropertyFixture();
    ownership.classification = {
      availability: "available",
      value: "individual",
      class: "inferred",
      evidenceRefs: ["ev_fixture_appraiser_001"],
    };
    expect(() => assertValidMcpFixture(fixture)).toThrow(ContractValidationError);
  });

  it("rejects empty mailing lines and situs substitution", () => {
    const empty = mutablePropertyFixture();
    const emptyMailing = record(empty.ownership.publicMailingAddress);
    record(record(emptyMailing.value).addressLines).value = [];
    expect(() => assertValidMcpFixture(empty.fixture)).toThrow(ContractValidationError);

    const substituted = mutablePropertyFixture();
    record(substituted.data.address).value =
      "900 EXAMPLE RECORD AVENUE, SAMPLEVILLE, FL 00000, US";
    expect(() => assertValidMcpFixture(substituted.fixture)).toThrow(
      ContractValidationError,
    );
  });

  it("rejects invented unavailable contacts and malformed available email", () => {
    const invented = mutablePropertyFixture();
    record(invented.ownership.phone).value = "+1-555-0100";
    expect(() => assertValidMcpFixture(invented.fixture)).toThrow(
      ContractValidationError,
    );

    const malformed = mutablePropertyFixture();
    malformed.ownership.email = {
      availability: "available",
      value: "not-an-email",
      class: "raw",
      evidenceRefs: ["ev_fixture_appraiser_001"],
    };
    expect(() => assertValidMcpFixture(malformed.fixture)).toThrow(
      ContractValidationError,
    );
  });

  it("rejects extra ownership fields and altered privacy metadata", () => {
    const extra = mutablePropertyFixture();
    extra.ownership.acquisitionDate = "2020-01-01";
    expect(() => assertValidMcpFixture(extra.fixture)).toThrow(ContractValidationError);

    const privateFixture = mutablePropertyFixture();
    record(privateFixture.ownership.privacy).publicationStatus = "private";
    expect(() => assertValidMcpFixture(privateFixture.fixture)).toThrow(
      ContractValidationError,
    );
  });

  it("accepts fictional owners with explicitly unavailable phone and email", () => {
    const { fixture, ownership } = mutablePropertyFixture();
    expect(record(ownership.phone)).toMatchObject({
      availability: "unavailable",
      value: null,
    });
    expect(record(ownership.email)).toMatchObject({
      availability: "unavailable",
      value: null,
    });
    expect(() => assertValidMcpFixture(fixture)).not.toThrow();
  });

  it("rejects a non-boolean retryable flag", () => {
    const invalid = clone(errorFixture) as unknown as {
      result: { error: { retryable: unknown } };
    };
    invalid.result.error.retryable = "no";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects fields on strict empty inputs", () => {
    const invalid = clone(serviceInfoRequestFixture) as {
      arguments: Record<string, unknown>;
    };
    invalid.arguments.county = "pasco";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects an incomplete six-tool service surface", () => {
    const invalid = clone(serviceInfoResponseFixture) as unknown as {
      result: { data: { supportedTools: string[] } };
    };
    invalid.result.data.supportedTools.pop();
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects zero permit counts when source coverage is unavailable", () => {
    const invalid = clone(pipelineRunSummaryResponseFixture) as unknown as {
      result: { data: { coverage: { permits: { recordCount: number | null } } } };
    };
    invalid.result.data.coverage.permits.recordCount = 0;
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects arbitrary SQL in a strict permit lookup", () => {
    const invalid = clone(permitRequestFixture) as unknown as {
      arguments: Record<string, unknown>;
    };
    invalid.arguments.sql = "select * from permits";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("rejects internal query capabilities", () => {
    const invalid = clone(querySchemaResponseFixture);
    invalid.result.data.queryRestrictions.internalSchemaExposure = true;
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
  });

  it("accepts zero matches separately from a missing record", () => {
    const zeroMatches = clone(searchResponseFixture) as unknown as {
      result: { data: { opportunities: unknown[] } };
    };
    zeroMatches.result.data.opportunities = [];
    expect(() => assertValidMcpFixture(zeroMatches)).not.toThrow();

    const missingRecord = clone(errorFixture);
    missingRecord.tool = "prism_v1_get_property";
    missingRecord.result.error.code = "not_found";
    missingRecord.result.error.message = "The requested property does not exist.";
    expect(() => assertValidMcpFixture(missingRecord)).not.toThrow();
  });

  it("matches the locked SHA-256 for the exact MCP schema bytes", async () => {
    expect(await sha256(contractLock.mcpSchema.path)).toBe(contractLock.mcpSchema.sha256);
    expect(EXPECTED_MCP_SCHEMA_SHA256).toBe(contractLock.mcpSchema.sha256);
  });

  it.each(contractLock.sharedFixtures)(
    "matches the locked bytes for $path",
    async (entry) => {
      expect(await sha256(entry.path)).toBe(entry.sha256);
    },
  );

  it("matches the locked bytes for the CRM lead schema", async () => {
    expect(await sha256(contractLock.crmLeadSchema.path)).toBe(
      contractLock.crmLeadSchema.sha256,
    );
  });
});
