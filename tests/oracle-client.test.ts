import { describe, expect, it } from "vitest";

import searchRequestFixture from "../contracts/fixtures/search-request.json";
import searchResponseFixture from "../contracts/fixtures/search-response.json";
import { ContractValidatingOracleClient } from "../src/oracle/client";
import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
  ProductionFixtureDataError,
} from "../src/oracle/contracts";
import type { OracleMcpTransport, SearchArguments } from "../src/oracle/types";

class StubTransport implements OracleMcpTransport {
  constructor(private readonly response: unknown) {}

  callTool(): Promise<unknown> {
    return Promise.resolve(structuredClone(this.response));
  }
}

const searchArguments = searchRequestFixture.arguments as SearchArguments;

describe("typed Oracle client boundary", () => {
  it("accepts a contract-valid structured response", async () => {
    const client = new ContractValidatingOracleClient(
      new StubTransport(searchResponseFixture.result),
      "test",
    );
    await expect(
      client.searchRoofingOpportunities(searchArguments),
    ).resolves.toMatchObject({
      ok: true,
      meta: { schemaHash: expect.any(String) },
    });
  });

  it("rejects a structurally invalid response before it crosses the boundary", async () => {
    const invalid = structuredClone(searchResponseFixture.result);
    invalid.data.opportunities[0]!.property.propertyId = "not-a-property-id";
    const client = new ContractValidatingOracleClient(new StubTransport(invalid), "test");
    await expect(
      client.searchRoofingOpportunities(searchArguments),
    ).rejects.toBeInstanceOf(ContractValidationError);
  });

  it("rejects a validly-shaped response with the wrong contract hash", async () => {
    const invalid = structuredClone(searchResponseFixture.result);
    invalid.meta.schemaHash = "0".repeat(64);
    const client = new ContractValidatingOracleClient(new StubTransport(invalid), "test");
    await expect(
      client.searchRoofingOpportunities(searchArguments),
    ).rejects.toBeInstanceOf(OracleSchemaHashMismatchError);
  });

  it("rejects fixture markers from an otherwise valid production response", async () => {
    const client = new ContractValidatingOracleClient(
      new StubTransport(searchResponseFixture.result),
      "production",
    );
    await expect(
      client.searchRoofingOpportunities(searchArguments),
    ).rejects.toBeInstanceOf(ProductionFixtureDataError);
  });
});
