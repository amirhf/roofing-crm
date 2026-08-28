import type { NodeEnvironment } from "@/oracle/types";

import { loadAgentRuntimeConfig, type AgentRuntimeConfig } from "./agent";
import { loadOracleRuntimeConfig, type OracleRuntimeConfig } from "./oracle";

export type LeadRepositoryKind = "memory" | "postgres";

export interface ApplicationRuntimeConfig {
  readonly nodeEnvironment: NodeEnvironment;
  readonly agent: AgentRuntimeConfig;
  readonly oracle: OracleRuntimeConfig;
  readonly leadRepository: LeadRepositoryKind;
  readonly databaseUrl: string | null;
  readonly sessionSecret: string;
}

export class ApplicationConfigurationError extends Error {
  constructor(message: string) {
    super(`Application configuration error: ${message}`);
    this.name = "ApplicationConfigurationError";
  }
}

export class ProductionMemoryRepositoryError extends ApplicationConfigurationError {
  constructor() {
    super("the in-memory lead repository is development/test-only.");
    this.name = "ProductionMemoryRepositoryError";
  }
}

function parseRepository(value: string | undefined): LeadRepositoryKind {
  if (value === "memory" || value === "postgres") return value;
  throw new ApplicationConfigurationError(
    `LEAD_REPOSITORY must be set explicitly to memory or postgres; received ${value ?? "undefined"}.`,
  );
}

function parseDatabaseUrl(value: string | undefined, required: boolean): string | null {
  if (!value) {
    if (required) {
      throw new ApplicationConfigurationError(
        "DATABASE_URL is required in production and whenever the postgres repository is selected.",
      );
    }
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApplicationConfigurationError("DATABASE_URL must be a valid URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ApplicationConfigurationError(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }
  return value;
}

function parseSessionSecret(value: string | undefined): string {
  if (!value) {
    throw new ApplicationConfigurationError("SESSION_SECRET is required.");
  }
  if (value.length < 32) {
    throw new ApplicationConfigurationError(
      "SESSION_SECRET must contain at least 32 characters.",
    );
  }
  return value;
}

export function loadApplicationRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApplicationRuntimeConfig {
  const oracle = loadOracleRuntimeConfig(environment);
  const leadRepository = parseRepository(environment.LEAD_REPOSITORY);

  if (oracle.nodeEnvironment === "production" && leadRepository === "memory") {
    throw new ProductionMemoryRepositoryError();
  }

  return {
    nodeEnvironment: oracle.nodeEnvironment,
    agent: loadAgentRuntimeConfig(oracle.nodeEnvironment, environment),
    oracle,
    leadRepository,
    databaseUrl: parseDatabaseUrl(
      environment.DATABASE_URL,
      oracle.nodeEnvironment === "production" || leadRepository === "postgres",
    ),
    sessionSecret: parseSessionSecret(environment.SESSION_SECRET),
  };
}
