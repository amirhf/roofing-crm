import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadOracleRuntimeConfig } from "../src/config/oracle";
import { createOracleClient } from "../src/oracle/factory";
import {
  assertCompatibleOracleTools,
  ensureOracleReadiness,
  ORACLE_READINESS_TTL_MS,
  OracleReadinessError,
  resetOracleReadinessForTests,
} from "../src/oracle/readiness";
import type { OracleClient } from "../src/oracle/types";

describe("Oracle readiness", () => {
  beforeEach(() => resetOracleReadinessForTests());

  it("validates the exact fixture-backed MCP surface and publication metadata", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });

    await expect(
      ensureOracleReadiness(config, createOracleClient(config)),
    ).resolves.toMatchObject({
      ready: true,
      contractVersion: "1.2.0",
      publication: {
        recordCount: 25,
        authoritativeComplete: false,
        roofSignalsProxy: 25,
        permits: "unavailable",
        contractors: "unavailable",
      },
    });
  });

  it("shares one in-flight probe across concurrent callers and caches the result", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    const base = createOracleClient(config);
    if (!base.discoverTools) throw new Error("Expected fixture tool discovery.");
    const discoverTools = vi.fn(base.discoverTools.bind(base));
    const getServiceInfo = vi.fn(base.getServiceInfo.bind(base));
    const getPipelineRunSummary = vi.fn(base.getPipelineRunSummary.bind(base));
    const getQuerySchema = vi.fn(base.getQuerySchema.bind(base));
    const client: OracleClient = {
      discoverTools,
      getServiceInfo,
      getPipelineRunSummary,
      searchRoofingOpportunities: base.searchRoofingOpportunities.bind(base),
      getProperty: base.getProperty.bind(base),
      getPermit: base.getPermit.bind(base),
      getQuerySchema,
    };

    const [first, second, third] = await Promise.all([
      ensureOracleReadiness(config, client),
      ensureOracleReadiness(config, client),
      ensureOracleReadiness(config, client),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(discoverTools).toHaveBeenCalledOnce();
    expect(getServiceInfo).toHaveBeenCalledOnce();
    expect(getPipelineRunSummary).toHaveBeenCalledOnce();
    expect(getQuerySchema).toHaveBeenCalledOnce();
  });

  it("keeps a slow in-flight probe shared after the success TTL duration", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    const base = createOracleClient(config);
    if (!base.discoverTools) throw new Error("Expected fixture tool discovery.");
    const descriptors = await base.discoverTools();
    let resolveDiscovery: ((value: typeof descriptors) => void) | undefined;
    const discoverTools = vi.fn(
      () =>
        new Promise<typeof descriptors>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    const client: OracleClient = {
      discoverTools,
      getServiceInfo: base.getServiceInfo.bind(base),
      getPipelineRunSummary: base.getPipelineRunSummary.bind(base),
      searchRoofingOpportunities: base.searchRoofingOpportunities.bind(base),
      getProperty: base.getProperty.bind(base),
      getPermit: base.getPermit.bind(base),
      getQuerySchema: base.getQuerySchema.bind(base),
    };
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = ensureOracleReadiness(config, client);
    now.mockReturnValue(1_000 + ORACLE_READINESS_TTL_MS + 1);
    const second = ensureOracleReadiness(config, client);

    expect(discoverTools).toHaveBeenCalledOnce();
    resolveDiscovery?.(descriptors);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(discoverTools).toHaveBeenCalledOnce();
    now.mockRestore();
  });

  it.each(["first", "second"] as const)(
    "lets the %s caller abort without cancelling the shared readiness probe",
    async (abortedCaller) => {
      const config = loadOracleRuntimeConfig({
        NODE_ENV: "test",
        ORACLE_DATA_SOURCE: "fixtures",
      });
      const base = createOracleClient(config);
      if (!base.discoverTools) throw new Error("Expected fixture tool discovery.");
      const descriptors = await base.discoverTools();
      let resolveDiscovery: ((value: typeof descriptors) => void) | undefined;
      const discoverTools = vi.fn(
        () =>
          new Promise<typeof descriptors>((resolve) => {
            resolveDiscovery = resolve;
          }),
      );
      const client: OracleClient = {
        discoverTools,
        getServiceInfo: base.getServiceInfo.bind(base),
        getPipelineRunSummary: base.getPipelineRunSummary.bind(base),
        searchRoofingOpportunities: base.searchRoofingOpportunities.bind(base),
        getProperty: base.getProperty.bind(base),
        getPermit: base.getPermit.bind(base),
        getQuerySchema: base.getQuerySchema.bind(base),
      };
      const firstController = new AbortController();
      const secondController = new AbortController();
      const first = ensureOracleReadiness(config, client, firstController.signal);
      const second = ensureOracleReadiness(config, client, secondController.signal);
      const aborted = abortedCaller === "first" ? firstController : secondController;
      const abortedPromise = abortedCaller === "first" ? first : second;
      const survivingPromise = abortedCaller === "first" ? second : first;

      aborted.abort(new DOMException("Caller left.", "AbortError"));
      await expect(abortedPromise).rejects.toMatchObject({ name: "AbortError" });
      resolveDiscovery?.(descriptors);
      await expect(survivingPromise).resolves.toMatchObject({ ready: true });
      expect(discoverTools).toHaveBeenCalledOnce();
    },
  );

  it("clears a rejected in-flight probe so a transient failure cannot poison the process", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    const base = createOracleClient(config);
    if (!base.discoverTools) throw new Error("Expected fixture tool discovery.");
    const discoverTools = vi
      .fn<NonNullable<OracleClient["discoverTools"]>>()
      .mockRejectedValueOnce(new Error("transient sentinel"))
      .mockImplementation(base.discoverTools.bind(base));
    const client: OracleClient = {
      discoverTools,
      getServiceInfo: base.getServiceInfo.bind(base),
      getPipelineRunSummary: base.getPipelineRunSummary.bind(base),
      searchRoofingOpportunities: base.searchRoofingOpportunities.bind(base),
      getProperty: base.getProperty.bind(base),
      getPermit: base.getPermit.bind(base),
      getQuerySchema: base.getQuerySchema.bind(base),
    };

    await expect(ensureOracleReadiness(config, client)).rejects.toBeInstanceOf(
      OracleReadinessError,
    );
    await expect(ensureOracleReadiness(config, client)).resolves.toMatchObject({
      ready: true,
    });
    expect(discoverTools).toHaveBeenCalledTimes(2);
  });

  it("rejects reordered tools, weakened inputs, and missing output schemas", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    const client = createOracleClient(config);
    if (!client.discoverTools) throw new Error("Expected fixture tool discovery.");
    const descriptors = await client.discoverTools();

    expect(() => assertCompatibleOracleTools([...descriptors].reverse())).toThrow(
      OracleReadinessError,
    );
    expect(() =>
      assertCompatibleOracleTools([
        {
          ...descriptors[0]!,
          inputSchema: {
            ...descriptors[0]!.inputSchema,
            $defs: {
              ...(descriptors[0]!.inputSchema.$defs as Record<string, unknown>),
              EmptyArguments: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
        ...descriptors.slice(1),
      ]),
    ).toThrow(OracleReadinessError);
    const nestedMismatch = structuredClone(descriptors);
    const definitions = nestedMismatch[2]!.inputSchema.$defs as Record<
      string,
      Record<string, unknown>
    >;
    const searchArguments = definitions.SearchArguments as {
      properties: { radius: { allOf: { then: { properties: { value: object } } }[] } };
    };
    searchArguments.properties.radius.allOf[0]!.then.properties.value = {
      maximum: 49,
    };
    expect(() => assertCompatibleOracleTools(nestedMismatch)).toThrow(
      OracleReadinessError,
    );
    expect(() =>
      assertCompatibleOracleTools([
        ...descriptors.slice(0, 5),
        { ...descriptors[5]!, outputSchema: null },
      ]),
    ).toThrow(OracleReadinessError);
  });

  it("rejects service identity mismatch and inconsistent publication counts", async () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    const base = createOracleClient(config);
    const service = await base.getServiceInfo();
    const pipeline = await base.getPipelineRunSummary();
    const discoverTools = base.discoverTools;
    if (!discoverTools) throw new Error("Expected fixture tool discovery.");
    if (!service.ok || !pipeline.ok) throw new Error("Expected fixture metadata.");
    const badService = structuredClone(service);
    (badService.data as Record<string, unknown>).activeContractHash = "0".repeat(64);
    const badPipeline = structuredClone(pipeline);
    const coverage = badPipeline.data.coverage as {
      coordinates: { available: number };
    };
    coverage.coordinates.available += 1;
    const client = (overrides: Partial<OracleClient>): OracleClient => ({
      discoverTools: discoverTools.bind(base),
      getServiceInfo: base.getServiceInfo.bind(base),
      getPipelineRunSummary: base.getPipelineRunSummary.bind(base),
      searchRoofingOpportunities: base.searchRoofingOpportunities.bind(base),
      getProperty: base.getProperty.bind(base),
      getPermit: base.getPermit.bind(base),
      getQuerySchema: base.getQuerySchema.bind(base),
      ...overrides,
    });

    await expect(
      ensureOracleReadiness(config, client({ getServiceInfo: async () => badService })),
    ).rejects.toBeInstanceOf(OracleReadinessError);
    resetOracleReadinessForTests();
    await expect(
      ensureOracleReadiness(
        config,
        client({ getPipelineRunSummary: async () => badPipeline }),
      ),
    ).rejects.toMatchObject({ stage: "publication_metadata" });
  });
});
