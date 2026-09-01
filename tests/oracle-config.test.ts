import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORACLE_MCP_TIMEOUT_MS,
  loadOracleRuntimeConfig,
  MAX_ORACLE_MCP_TIMEOUT_MS,
  MIN_ORACLE_MCP_TIMEOUT_MS,
  OracleConfigurationError,
  ProductionFixtureSelectionError,
} from "../src/config/oracle";
import { DevelopmentFixtureOracleClient } from "../src/oracle/fixture-adapter";

describe("Oracle runtime isolation", () => {
  it("allows the fixture adapter only when development/test selects it explicitly", () => {
    const config = loadOracleRuntimeConfig({
      NODE_ENV: "test",
      ORACLE_DATA_SOURCE: "fixtures",
    });
    expect(config).toMatchObject({
      nodeEnvironment: "test",
      dataSource: "fixtures",
      oracleMcpUrl: null,
      oracleMcpTimeoutMs: DEFAULT_ORACLE_MCP_TIMEOUT_MS,
    });
    expect(() => new DevelopmentFixtureOracleClient("test")).not.toThrow();
  });

  it("prevents production from selecting the fixture adapter", () => {
    expect(() =>
      loadOracleRuntimeConfig({
        NODE_ENV: "production",
        ORACLE_DATA_SOURCE: "fixtures",
        ORACLE_MCP_URL: "https://oracle.example.test/mcp",
      }),
    ).toThrow(ProductionFixtureSelectionError);
    expect(() => new DevelopmentFixtureOracleClient("production")).toThrow(
      ProductionFixtureSelectionError,
    );
  });

  it("fails production explicitly when ORACLE_MCP_URL is missing", () => {
    expect(() =>
      loadOracleRuntimeConfig({
        NODE_ENV: "production",
        ORACLE_DATA_SOURCE: "mcp",
      }),
    ).toThrowError(
      new OracleConfigurationError(
        "ORACLE_MCP_URL is required for production and whenever the MCP adapter is selected.",
      ),
    );
  });

  it("does not silently fall back to fixtures when MCP configuration is absent", () => {
    expect(() =>
      loadOracleRuntimeConfig({
        NODE_ENV: "development",
      }),
    ).toThrow(/ORACLE_MCP_URL is required/);
  });

  it("defaults production MCP operations to a bounded 45-second deadline", () => {
    expect(
      loadOracleRuntimeConfig({
        NODE_ENV: "production",
        ORACLE_DATA_SOURCE: "mcp",
        ORACLE_MCP_URL: "https://oracle.example.test/mcp",
      }).oracleMcpTimeoutMs,
    ).toBe(DEFAULT_ORACLE_MCP_TIMEOUT_MS);
  });

  it.each([
    String(MIN_ORACLE_MCP_TIMEOUT_MS),
    "45000",
    String(MAX_ORACLE_MCP_TIMEOUT_MS),
  ])("accepts a bounded integer MCP timeout: %s", (timeout) => {
    expect(
      loadOracleRuntimeConfig({
        NODE_ENV: "test",
        ORACLE_DATA_SOURCE: "fixtures",
        ORACLE_MCP_TIMEOUT_MS: timeout,
      }).oracleMcpTimeoutMs,
    ).toBe(Number(timeout));
  });

  it.each(["", "0", "-1", "4999", "60001", "45000.5", "5e3", "word"])(
    "rejects an invalid MCP timeout: %s",
    (timeout) => {
      expect(() =>
        loadOracleRuntimeConfig({
          NODE_ENV: "test",
          ORACLE_DATA_SOURCE: "fixtures",
          ORACLE_MCP_TIMEOUT_MS: timeout,
        }),
      ).toThrow(/ORACLE_MCP_TIMEOUT_MS must be an integer from 5000 through 60000/);
    },
  );
});
