import type { NodeEnvironment } from "@/oracle/types";

export type OracleDataSource = "mcp" | "fixtures";

export interface OracleRuntimeConfig {
  readonly nodeEnvironment: NodeEnvironment;
  readonly dataSource: OracleDataSource;
  readonly oracleMcpUrl: URL | null;
  readonly oracleMcpTimeoutMs: number;
}

export const DEFAULT_ORACLE_MCP_TIMEOUT_MS = 45_000;
export const MIN_ORACLE_MCP_TIMEOUT_MS = 5_000;
export const MAX_ORACLE_MCP_TIMEOUT_MS = 60_000;

export class OracleConfigurationError extends Error {
  constructor(message: string) {
    super(`Oracle configuration error: ${message}`);
    this.name = "OracleConfigurationError";
  }
}

export class ProductionFixtureSelectionError extends OracleConfigurationError {
  constructor() {
    super(
      "the fixture adapter is development/test-only and cannot be selected in production.",
    );
    this.name = "ProductionFixtureSelectionError";
  }
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  throw new OracleConfigurationError(
    `NODE_ENV must be development, test, or production; received ${value ?? "undefined"}.`,
  );
}

function parseDataSource(value: string | undefined): OracleDataSource {
  if (value === undefined || value === "mcp") {
    return "mcp";
  }
  if (value === "fixtures") {
    return "fixtures";
  }
  throw new OracleConfigurationError(
    `ORACLE_DATA_SOURCE must be mcp or fixtures; received ${value}.`,
  );
}

function parseMcpUrl(value: string | undefined, required: boolean): URL | null {
  if (!value) {
    if (required) {
      throw new OracleConfigurationError(
        "ORACLE_MCP_URL is required for production and whenever the MCP adapter is selected.",
      );
    }
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OracleConfigurationError("ORACLE_MCP_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OracleConfigurationError("ORACLE_MCP_URL must use http or https.");
  }
  return url;
}

function parseMcpTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_ORACLE_MCP_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) {
    throw new OracleConfigurationError(
      `ORACLE_MCP_TIMEOUT_MS must be an integer from ${MIN_ORACLE_MCP_TIMEOUT_MS} through ${MAX_ORACLE_MCP_TIMEOUT_MS}.`,
    );
  }
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_ORACLE_MCP_TIMEOUT_MS ||
    timeoutMs > MAX_ORACLE_MCP_TIMEOUT_MS
  ) {
    throw new OracleConfigurationError(
      `ORACLE_MCP_TIMEOUT_MS must be an integer from ${MIN_ORACLE_MCP_TIMEOUT_MS} through ${MAX_ORACLE_MCP_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

export function loadOracleRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OracleRuntimeConfig {
  const nodeEnvironment = parseNodeEnvironment(environment.NODE_ENV);
  const dataSource = parseDataSource(environment.ORACLE_DATA_SOURCE);

  if (nodeEnvironment === "production" && dataSource === "fixtures") {
    throw new ProductionFixtureSelectionError();
  }

  return {
    nodeEnvironment,
    dataSource,
    oracleMcpUrl: parseMcpUrl(
      environment.ORACLE_MCP_URL,
      nodeEnvironment === "production" || dataSource === "mcp",
    ),
    oracleMcpTimeoutMs: parseMcpTimeout(environment.ORACLE_MCP_TIMEOUT_MS),
  };
}
