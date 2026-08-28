import { describe, expect, it } from "vitest";

import {
  loadOracleRuntimeConfig,
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
});
