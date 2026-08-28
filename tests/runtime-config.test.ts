import { describe, expect, it } from "vitest";

import {
  ApplicationConfigurationError,
  loadApplicationRuntimeConfig,
  ProductionMemoryRepositoryError,
} from "../src/config/runtime";
import { ProductionFixtureSelectionError } from "../src/config/oracle";

const productionBase = {
  NODE_ENV: "production",
  ORACLE_DATA_SOURCE: "mcp",
  ORACLE_MCP_URL: "https://oracle.example.test/mcp",
  LEAD_REPOSITORY: "postgres",
  DATABASE_URL: "postgresql://user:pass@db.example.test/roofline",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
} as const;

describe("application production isolation", () => {
  it("accepts only the production MCP and postgres configuration", () => {
    expect(loadApplicationRuntimeConfig(productionBase)).toMatchObject({
      nodeEnvironment: "production",
      leadRepository: "postgres",
      databaseUrl: productionBase.DATABASE_URL,
      sessionSecret: productionBase.SESSION_SECRET,
      oracle: { dataSource: "mcp" },
    });
  });

  it("rejects fixture selection before constructing any adapter", () => {
    expect(() =>
      loadApplicationRuntimeConfig({
        ...productionBase,
        ORACLE_DATA_SOURCE: "fixtures",
      }),
    ).toThrow(ProductionFixtureSelectionError);
  });

  it("rejects the in-memory repository in production", () => {
    expect(() =>
      loadApplicationRuntimeConfig({
        ...productionBase,
        LEAD_REPOSITORY: "memory",
      }),
    ).toThrow(ProductionMemoryRepositoryError);
  });

  it.each([
    ["ORACLE_MCP_URL", /ORACLE_MCP_URL is required/],
    ["DATABASE_URL", /DATABASE_URL is required/],
    ["SESSION_SECRET", /SESSION_SECRET is required/],
  ] as const)("fails visibly when %s is missing", (key, expected) => {
    const environment: Record<string, string | undefined> = { ...productionBase };
    delete environment[key];
    expect(() => loadApplicationRuntimeConfig(environment)).toThrow(expected);
  });

  it("requires explicit development persistence instead of falling back", () => {
    expect(() =>
      loadApplicationRuntimeConfig({
        NODE_ENV: "development",
        ORACLE_DATA_SOURCE: "fixtures",
        SESSION_SECRET: productionBase.SESSION_SECRET,
      }),
    ).toThrow(ApplicationConfigurationError);
  });
});
