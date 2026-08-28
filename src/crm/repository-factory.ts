import type { ApplicationRuntimeConfig } from "@/config/runtime";

import { DevelopmentMemoryLeadRepository } from "./memory-repository";
import { NeonLeadRepository } from "./neon-repository";
import type { LeadRepository } from "./repository";

declare global {
  var rooflineLeadRepository:
    { readonly key: string; readonly repository: LeadRepository } | undefined;
}

export function getLeadRepository(config: ApplicationRuntimeConfig): LeadRepository {
  const key = `${config.nodeEnvironment}:${config.leadRepository}:${config.databaseUrl ?? "none"}`;
  if (globalThis.rooflineLeadRepository?.key === key) {
    return globalThis.rooflineLeadRepository.repository;
  }

  let repository: LeadRepository;
  if (config.leadRepository === "memory") {
    if (config.nodeEnvironment === "production") {
      throw new Error("Production cannot construct the in-memory repository.");
    }
    repository = new DevelopmentMemoryLeadRepository(config.nodeEnvironment);
  } else {
    if (!config.databaseUrl) {
      throw new Error("Postgres repository requires DATABASE_URL.");
    }
    repository = new NeonLeadRepository(config.databaseUrl);
  }
  globalThis.rooflineLeadRepository = { key, repository };
  return repository;
}

export function resetLeadRepositoryForTests(): void {
  globalThis.rooflineLeadRepository = undefined;
}
