import { randomUUID } from "node:crypto";

export interface ServerErrorEvent {
  readonly requestId: string;
  readonly operation: string;
  readonly errorClass: string;
  readonly latencyMs: number;
  readonly attemptCount?: number;
  readonly statusCategory?: string;
  readonly initializationStage?: string;
}

export interface ServerQuerySuccessEvent {
  readonly requestId: string;
  readonly operation: "grounded_property_query";
  readonly sessionIdHash: `sha256:${string}`;
  readonly requestedProvider: "gateway" | "mock";
  readonly requestedModel: string;
  readonly sdkResponseModel: string | null;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string | null;
  readonly modelGenerations: number;
  readonly sdkAttemptCount: number;
  readonly sdkRetryCount: 0;
  readonly providerAttemptCount: number | null;
  readonly oracleToolCallCount: number;
  readonly queryLatencyMs: number;
  readonly modelLatencyMs: number | null;
  readonly oracleLatencyMs: number;
  readonly gatewayGenerationTimeMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly costUsd: number | null;
  readonly finishReason: string | null;
  readonly completion: "grounded" | "cannot_ground";
  readonly tags: readonly string[];
}

export function createRequestId(): string {
  return randomUUID();
}

export function sanitizedErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name) ? name : "UnknownError";
}

export function recordServerError(event: ServerErrorEvent): void {
  if (process.env.NODE_ENV === "test") return;
  console.error(JSON.stringify({ event: "roofline_server_error", ...event }));
}

export function recordServerQuerySuccess(event: ServerQuerySuccessEvent): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ event: "roofline_grounded_query", ...event }));
}
