import type { NodeEnvironment } from "@/oracle/types";

export type AgentProvider = "gateway";

export interface AgentRuntimeConfig {
  readonly configured: boolean;
  readonly provider: AgentProvider | null;
  readonly modelId: string | null;
}

export class AgentConfigurationError extends Error {
  constructor(message: string) {
    super(`Agent configuration error: ${message}`);
    this.name = "AgentConfigurationError";
  }
}

export class AgentModelSlugError extends AgentConfigurationError {
  constructor() {
    super(
      "AI_MODEL must use the lowercase provider/model slug format and be no longer than 200 characters.",
    );
    this.name = "AgentModelSlugError";
  }
}

function parseProvider(value: string | undefined): AgentProvider | null {
  if (value === undefined || value === "") return null;
  if (value === "gateway") return value;
  throw new AgentConfigurationError(
    `AI_PROVIDER must be gateway when configured; received ${value}.`,
  );
}

function parseModelId(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (
    value.length > 200 ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)
  ) {
    throw new AgentModelSlugError();
  }
  return value;
}

export function loadAgentRuntimeConfig(
  nodeEnvironment: NodeEnvironment,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentRuntimeConfig {
  const provider = parseProvider(environment.AI_PROVIDER);
  const modelId = parseModelId(environment.AI_MODEL);

  if ((provider === null) !== (modelId === null)) {
    throw new AgentConfigurationError(
      "AI_PROVIDER and AI_MODEL must either both be set or both be absent.",
    );
  }
  if (nodeEnvironment === "production" && (provider === null || modelId === null)) {
    throw new AgentConfigurationError(
      "AI_PROVIDER and AI_MODEL are required in production.",
    );
  }

  return {
    configured: provider !== null && modelId !== null,
    provider,
    modelId,
  };
}
