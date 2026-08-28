import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import contractLock from "../contracts/contract-lock.json";
import errorFixture from "../contracts/fixtures/error-response.json";
import permitFixture from "../contracts/fixtures/permit-response.json";
import propertyFixture from "../contracts/fixtures/property-response.json";
import searchRequestFixture from "../contracts/fixtures/search-request.json";
import searchResponseFixture from "../contracts/fixtures/search-response.json";
import {
  assertValidMcpFixture,
  ContractValidationError,
  EXPECTED_MCP_SCHEMA_SHA256,
} from "../src/oracle/contracts";

const fixtures = [
  ["error response", errorFixture],
  ["permit response", permitFixture],
  ["property response", propertyFixture],
  ["search request", searchRequestFixture],
  ["search response", searchResponseFixture],
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
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

  it("rejects a non-boolean retryable flag", () => {
    const invalid = clone(errorFixture) as unknown as {
      result: { error: { retryable: unknown } };
    };
    invalid.result.error.retryable = "no";
    expect(() => assertValidMcpFixture(invalid)).toThrow(ContractValidationError);
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
