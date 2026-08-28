import "server-only";

import type { AgentModelAdapter } from "./provider";
import { z } from "zod";

import { createAgentModelAdapter } from "@/agent/provider";
import { naturalLanguageQueryRequestSchema } from "@/agent/schemas";
import type { NaturalLanguageQueryResult } from "@/agent/types";
import {
  ApplicationConfigurationError,
  loadApplicationRuntimeConfig,
  type ApplicationRuntimeConfig,
} from "@/config/runtime";
import { AgentConfigurationError, AgentModelSlugError } from "@/config/agent";
import { createOracleClient } from "@/oracle/factory";
import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import { jsonResponse } from "@/server/request-context";
import {
  assertSameOrigin,
  resolveAnonymousSession,
  SameOriginError,
} from "@/server/session";

import {
  AgentBusyError,
  AgentGroundingError,
  AgentMcpError,
  AgentResponseSizeError,
  AgentToolLimitError,
} from "./errors";
import { runGroundedAgent } from "./grounded-agent";
import { acquireAgentSession } from "./session-gate";

interface QueryHandlerDependencies {
  readonly loadConfig?: () => ApplicationRuntimeConfig;
  readonly createModel?: (config: ApplicationRuntimeConfig) => AgentModelAdapter | null;
  readonly createOracle?: typeof createOracleClient;
  readonly acquireSession?: typeof acquireAgentSession;
  readonly runAgent?: typeof runGroundedAgent;
}

function errorResult(
  code: Extract<NaturalLanguageQueryResult, { status: "error" }>["error"]["code"],
  message: string,
  retryAfterSeconds?: number,
): NaturalLanguageQueryResult {
  return {
    status: "error",
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}

const MAX_RETRY_AFTER_SECONDS = 300;

interface GatewayTransportMetadata {
  readonly statusCode: number | null;
  readonly responseHeaders: unknown;
}

function gatewayTransportMetadata(error: unknown): GatewayTransportMetadata {
  let current: unknown = error;
  let statusCode: number | null = null;
  let responseHeaders: unknown;
  const visited = new Set<unknown>();

  for (
    let depth = 0;
    depth < 6 && typeof current === "object" && current !== null;
    depth += 1
  ) {
    if (visited.has(current)) break;
    visited.add(current);
    if (
      statusCode === null &&
      "statusCode" in current &&
      typeof current.statusCode === "number"
    ) {
      statusCode = current.statusCode;
    }
    if (responseHeaders === undefined && "responseHeaders" in current) {
      responseHeaders = current.responseHeaders;
    }
    current = "cause" in current ? current.cause : null;
  }

  return { statusCode, responseHeaders };
}

function responseHeader(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (typeof headers !== "object" || headers === null) return null;
  const entries = Object.entries(headers as Record<string, unknown>);
  const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof match?.[1] === "string" ? match[1] : null;
}

function boundedRetryAfterSeconds(headers: unknown): number | undefined {
  const value = responseHeader(headers, "retry-after")?.trim();
  if (!value) return undefined;

  const deltaSeconds = Number(value);
  if (Number.isFinite(deltaSeconds) && deltaSeconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(deltaSeconds));
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000)),
  );
}

function timeoutLike(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (
      current.name === "TimeoutError" ||
      current.name === "AbortError" ||
      /timed?\s*out|timeout/i.test(current.message)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function classifiedError(error: unknown): {
  body: NaturalLanguageQueryResult;
  status: number;
  retryAfterSeconds?: number;
} {
  if (error instanceof AgentBusyError) {
    return { body: errorResult("busy", error.message), status: 429 };
  }
  if (error instanceof AgentToolLimitError) {
    return { body: errorResult("tool_limit", error.message), status: 422 };
  }
  if (error instanceof AgentGroundingError) {
    return { body: errorResult("grounding_rejected", error.message), status: 422 };
  }
  if (error instanceof AgentMcpError) {
    return { body: errorResult("mcp_error", error.message), status: 503 };
  }
  if (
    error instanceof ContractValidationError ||
    error instanceof OracleSchemaHashMismatchError ||
    error instanceof AgentResponseSizeError
  ) {
    return {
      body: errorResult(
        "invalid_mcp_response",
        "Oracle returned data that failed the frozen contract or response bounds.",
      ),
      status: 502,
    };
  }
  if (error instanceof Error && error.name === "AgentInvalidToolArgumentsError") {
    return { body: errorResult("invalid_tool_arguments", error.message), status: 422 };
  }
  const gateway = gatewayTransportMetadata(error);
  if (gateway.statusCode === 402) {
    return {
      body: errorResult(
        "ai_budget_unavailable",
        "The AI Gateway budget is currently unavailable.",
      ),
      status: 402,
    };
  }
  if (gateway.statusCode === 429) {
    const retryAfterSeconds = boundedRetryAfterSeconds(gateway.responseHeaders);
    return {
      body: errorResult(
        "ai_rate_limited",
        "The AI Gateway rate limit was reached.",
        retryAfterSeconds,
      ),
      status: 429,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (gateway.statusCode === 503) {
    return {
      body: errorResult(
        "ai_temporarily_unavailable",
        "The configured AI model or provider is temporarily unavailable.",
      ),
      status: 503,
    };
  }
  if (gateway.statusCode === 401 || gateway.statusCode === 403) {
    return {
      body: errorResult(
        "ai_authentication_failed",
        "AI Gateway authentication or authorization failed.",
      ),
      status: 503,
    };
  }
  if (gateway.statusCode === 400 || gateway.statusCode === 404) {
    return {
      body: errorResult(
        "ai_model_unavailable",
        "The configured AI model slug is malformed or unavailable.",
      ),
      status: 503,
    };
  }
  if (timeoutLike(error)) {
    return {
      body: errorResult(
        "timeout",
        "The grounded query exceeded its 12-second server deadline.",
      ),
      status: 504,
    };
  }
  if (error instanceof AgentModelSlugError) {
    return {
      body: errorResult(
        "ai_model_unavailable",
        "The configured AI model slug is malformed or unavailable.",
      ),
      status: 503,
    };
  }
  if (
    error instanceof ApplicationConfigurationError ||
    error instanceof AgentConfigurationError
  ) {
    return {
      body: errorResult(
        "ai_configuration_error",
        "The server configuration required for grounded AI queries is unavailable.",
      ),
      status: 503,
    };
  }
  return {
    body: errorResult(
      "model_error",
      "The configured model could not complete the grounded query.",
    ),
    status: 502,
  };
}

export function createQueryPostHandler(
  dependencies: QueryHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  const loadConfig =
    dependencies.loadConfig ?? (() => loadApplicationRuntimeConfig(process.env));
  const createModel =
    dependencies.createModel ?? ((config) => createAgentModelAdapter(config.agent));
  const createOracle = dependencies.createOracle ?? createOracleClient;
  const acquireSession = dependencies.acquireSession ?? acquireAgentSession;
  const runAgent = dependencies.runAgent ?? runGroundedAgent;

  return async function queryPost(request: Request): Promise<Response> {
    let setCookieHeader: string | null = null;
    let release: (() => void) | null = null;
    try {
      assertSameOrigin(request);
      const config = loadConfig();
      const session = resolveAnonymousSession(
        request.headers.get("cookie"),
        config.sessionSecret,
      );
      setCookieHeader = session.setCookieHeader;
      const model = createModel(config);
      if (!model) {
        const result: NaturalLanguageQueryResult = {
          status: "not_configured",
          message:
            "The grounded query model is not configured. Set AI_PROVIDER and AI_MODEL, or use structured search.",
        };
        return jsonResponse(result, { status: 503 }, setCookieHeader);
      }

      const rawInput: unknown = await request.json();
      const input = naturalLanguageQueryRequestSchema.parse(rawInput);
      release = acquireSession(session.sessionIdHash);
      const grounded = await runAgent({
        model: model.model,
        oracleClient: createOracle(config.oracle),
        nodeEnvironment: config.nodeEnvironment,
        sessionIdHash: session.sessionIdHash,
        request: input,
        abortSignal: request.signal,
      });
      const result: NaturalLanguageQueryResult = {
        status: "complete",
        grounded,
      };
      return jsonResponse(result, {}, setCookieHeader);
    } catch (error) {
      if (error instanceof SameOriginError) {
        return jsonResponse(errorResult("invalid_request", error.message), {
          status: 403,
        });
      }
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return jsonResponse(
          errorResult(
            "invalid_request",
            "Query input must match the bounded natural-language request schema.",
          ),
          { status: 400 },
          setCookieHeader,
        );
      }
      const classified = classifiedError(error);
      return jsonResponse(
        classified.body,
        {
          status: classified.status,
          ...(classified.retryAfterSeconds === undefined
            ? {}
            : { headers: { "Retry-After": String(classified.retryAfterSeconds) } }),
        },
        setCookieHeader,
      );
    } finally {
      release?.();
    }
  };
}
