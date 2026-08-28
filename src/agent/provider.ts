import "server-only";

import { gateway, type LanguageModel } from "ai";

import type { AgentRuntimeConfig } from "@/config/agent";

export interface AgentModelAdapter {
  readonly provider: "gateway" | "mock";
  readonly modelId: string;
  readonly model: LanguageModel;
}

export function createAgentModelAdapter(
  config: AgentRuntimeConfig,
): AgentModelAdapter | null {
  if (!config.configured || config.provider === null || config.modelId === null) {
    return null;
  }

  return {
    provider: "gateway",
    modelId: config.modelId,
    model: gateway(config.modelId),
  };
}
