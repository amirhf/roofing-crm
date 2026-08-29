import { describe, expect, it, vi } from "vitest";

import searchRequestFixture from "../contracts/fixtures/search-request.json";
import searchResponseFixture from "../contracts/fixtures/search-response.json";
import { ContractValidatingOracleClient } from "../src/oracle/client";
import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
  ProductionFixtureDataError,
} from "../src/oracle/contracts";
import {
  createBoundedOracleFetch,
  OracleMcpTransportError,
  OracleMcpResponseSizeError,
  settleBoundedOracleClose,
  StreamableHttpOracleMcpTransport,
} from "../src/oracle/mcp-transport";
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

  it("rejects a response that reports the wrong MCP contract version", async () => {
    const invalid = structuredClone(searchResponseFixture.result);
    invalid.meta.contractVersion = "1.1.0" as never;
    const client = new ContractValidatingOracleClient(new StubTransport(invalid), "test");
    await expect(
      client.searchRoofingOpportunities(searchArguments),
    ).rejects.toBeInstanceOf(ContractValidationError);
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

  it("rejects an oversized MCP response from Content-Length before parsing", async () => {
    const boundedFetch = createBoundedOracleFetch(
      async () =>
        new Response("too large", {
          headers: { "Content-Length": "9" },
        }),
      8,
    );
    await expect(boundedFetch("https://oracle.example.test/mcp")).rejects.toBeInstanceOf(
      OracleMcpResponseSizeError,
    );
  });

  it("stops an oversized streamed MCP response without Content-Length", async () => {
    const boundedFetch = createBoundedOracleFetch(
      async () => new Response("streamed response"),
      8,
    );
    const response = await boundedFetch("https://oracle.example.test/mcp");
    await expect(response.text()).rejects.toBeInstanceOf(OracleMcpResponseSizeError);
  });

  it("aborts an in-flight MCP transport fetch when the caller signal fires", async () => {
    let resolveObservedAbort!: (signal: AbortSignal) => void;
    const observedAbort = new Promise<AbortSignal>((resolve) => {
      resolveObservedAbort = resolve;
    });
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("MCP transport did not supply a fetch abort signal."));
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              resolveObservedAbort(signal);
              reject(new DOMException("MCP fetch aborted.", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const transport = new StreamableHttpOracleMcpTransport(
      new URL("https://oracle.example.test/mcp"),
      fetch,
    );
    const controller = new AbortController();
    const pending = transport.callTool(
      "prism_v1_search_roofing_opportunities",
      { ...searchArguments },
      { signal: controller.signal, timeoutMs: 1_000 },
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(OracleMcpTransportError);
    await expect(observedAbort).resolves.toMatchObject({ aborted: true });
  });

  it("applies the timeout to MCP initialization, not only the tool call", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Initialization timed out.", "AbortError")),
            { once: true },
          );
        }),
    );
    const transport = new StreamableHttpOracleMcpTransport(
      new URL("https://oracle.example.test/mcp"),
      fetch,
    );
    const startedAt = Date.now();

    await expect(transport.listToolNames({ timeoutMs: 25 })).rejects.toBeInstanceOf(
      OracleMcpTransportError,
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("settles cleanup when an MCP client close never resolves", async () => {
    const startedAt = Date.now();
    await settleBoundedOracleClose(
      async () => await new Promise<void>(() => undefined),
      undefined,
      20,
    );
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
