import "server-only";

import type { OracleRuntimeConfig } from "../config/oracle";

import { ContractValidatingOracleClient } from "./client";
import { DevelopmentFixtureOracleClient } from "./fixture-adapter";
import { StreamableHttpOracleMcpTransport } from "./mcp-transport";
import type { OracleClient } from "./types";

export function createOracleClient(config: OracleRuntimeConfig): OracleClient {
  if (config.dataSource === "fixtures") {
    return new DevelopmentFixtureOracleClient(config.nodeEnvironment);
  }
  if (!config.oracleMcpUrl) {
    throw new Error("Invariant violated: the MCP adapter requires ORACLE_MCP_URL.");
  }
  return new ContractValidatingOracleClient(
    new StreamableHttpOracleMcpTransport(config.oracleMcpUrl),
    config.nodeEnvironment,
  );
}
