import { randomUUID } from "node:crypto";

export interface ServerErrorEvent {
  readonly requestId: string;
  readonly operation: string;
  readonly errorClass: string;
  readonly latencyMs: number;
  readonly attemptCount?: number;
  readonly statusCategory?: string;
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
