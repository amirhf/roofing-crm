import "server-only";

import { GatewayError } from "@ai-sdk/gateway";
import type { AgentModelAdapter } from "./provider";
import type { RequestReferenceTokenSource } from "./request-references";
import { z } from "zod";

import { createAgentModelAdapter } from "@/agent/provider";
import {
  agentBoundsForOracleTimeout,
  naturalLanguageQueryRequestSchema,
} from "@/agent/schemas";
import type {
  AgentExecutionTelemetry,
  NaturalLanguageQueryResult,
  QuerySuccessMetadata,
} from "@/agent/types";
import {
  ApplicationConfigurationError,
  loadApplicationRuntimeConfig,
  type ApplicationRuntimeConfig,
} from "@/config/runtime";
import { AgentConfigurationError, AgentModelSlugError } from "@/config/agent";
import { createOracleClient } from "@/oracle/factory";
import {
  ensureOracleReadiness,
  OracleReadinessError,
  oracleReadinessStage,
} from "@/oracle/readiness";
import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import {
  OracleMcpResponseSizeError,
  OracleMcpTransportError,
} from "@/oracle/mcp-transport";
import { jsonResponse } from "@/server/request-context";
import {
  createRequestId,
  recordServerError,
  recordServerQuerySuccess,
  sanitizedErrorClass,
  type ServerErrorEvent,
  type ServerQuerySuccessEvent,
} from "@/server/error-telemetry";
import {
  assertSameOrigin,
  resolveAnonymousSession,
  SameOriginError,
} from "@/server/session";

import {
  AgentBusyError,
  AgentGroundingError,
  AgentIntentValidationError,
  AgentMcpError,
  AgentPrivacyError,
  AgentReferenceError,
  AgentResponseSizeError,
  AgentToolLimitError,
} from "./errors";
import { agentGatewayTags, runGroundedAgent } from "./grounded-agent";
import { acquireAgentSession } from "./session-gate";

interface QueryHandlerDependencies {
  readonly loadConfig?: () => ApplicationRuntimeConfig;
  readonly createModel?: (config: ApplicationRuntimeConfig) => AgentModelAdapter | null;
  readonly createOracle?: typeof createOracleClient;
  readonly ensureReadiness?: typeof ensureOracleReadiness;
  readonly acquireSession?: typeof acquireAgentSession;
  readonly runAgent?: typeof runGroundedAgent;
  readonly recordError?: (event: ServerErrorEvent) => void;
  readonly recordSuccess?: (event: ServerQuerySuccessEvent) => void;
  readonly referenceTokenSource?: RequestReferenceTokenSource;
}

const QUERY_ROUTE_DEADLINE_MS = 85_000;

function successLogEvent(
  metadata: QuerySuccessMetadata,
  sessionIdHash: `sha256:${string}`,
): ServerQuerySuccessEvent {
  return {
    requestId: metadata.requestId,
    operation: "grounded_property_query",
    sessionIdHash,
    requestedProvider: metadata.requestedProvider,
    requestedModel: metadata.requestedModel,
    sdkResponseModel: metadata.sdkResponseModel.value,
    resolvedProvider: metadata.resolvedProvider.value,
    resolvedModel: metadata.resolvedModel.value,
    modelGenerations: metadata.modelGenerations,
    sdkAttemptCount: metadata.sdkAttemptCount,
    sdkRetryCount: metadata.sdkRetryCount,
    providerAttemptCount: metadata.providerAttemptCount.value,
    oracleToolCallCount: metadata.oracleToolCallCount,
    queryLatencyMs: metadata.queryLatencyMs,
    modelLatencyMs: metadata.modelLatencyMs.value,
    oracleLatencyMs: metadata.oracleLatencyMs,
    gatewayGenerationTimeMs: metadata.gatewayGenerationTimeMs.value,
    inputTokens: metadata.inputTokens.value,
    outputTokens: metadata.outputTokens.value,
    totalTokens: metadata.totalTokens.value,
    costUsd: metadata.costUsd.value,
    finishReason: metadata.finishReason.value,
    completion: metadata.completion,
    tags: metadata.attribution.tags,
  };
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
  readonly statusCode: number;
  readonly type: string;
  readonly responseHeaders: unknown;
}

function gatewayTransportMetadata(error: unknown): GatewayTransportMetadata | null {
  let current: unknown = error;
  let statusCode: number | null = null;
  let type: string | null = null;
  let responseHeaders: unknown;
  const visited = new Set<unknown>();

  for (
    let depth = 0;
    depth < 6 && typeof current === "object" && current !== null;
    depth += 1
  ) {
    if (visited.has(current)) break;
    visited.add(current);
    if (GatewayError.isInstance(current)) {
      statusCode = current.statusCode;
      type = current.type;
    }
    if (responseHeaders === undefined && "responseHeaders" in current) {
      responseHeaders = current.responseHeaders;
    }
    current = "cause" in current ? current.cause : null;
  }

  return statusCode === null || type === null
    ? null
    : { statusCode, type, responseHeaders };
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

  if (/^\d+$/.test(value)) {
    const deltaSeconds = Number(value);
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(deltaSeconds));
  }

  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  ) {
    return undefined;
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt) || new Date(retryAt).toUTCString() !== value) {
    return undefined;
  }
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
  if (error instanceof AgentPrivacyError) {
    return {
      body: errorResult(
        "invalid_request",
        "The query contains details that cannot be safely sent to the model. Use the map controls for the search center and remove owner, contact, address, parcel, coordinate, or contractor values.",
      ),
      status: 400,
    };
  }
  if (error instanceof AgentIntentValidationError) {
    return {
      body: errorResult(
        "invalid_request",
        "The query could not be converted into a supported bounded roofing search. Rephrase it using roof age, radius, permit duration, sorting, or result limits.",
      ),
      status: 400,
    };
  }
  if (error instanceof AgentToolLimitError) {
    return { body: errorResult("tool_limit", error.message), status: 422 };
  }
  if (error instanceof AgentGroundingError) {
    return { body: errorResult("grounding_rejected", error.message), status: 422 };
  }
  if (error instanceof AgentReferenceError) {
    return {
      body: errorResult(
        "invalid_tool_arguments",
        "The model used an invalid request-scoped Oracle reference.",
      ),
      status: 422,
    };
  }
  if (error instanceof AgentMcpError) {
    return {
      body: errorResult("mcp_error", "Oracle MCP could not complete the request."),
      status: 503,
    };
  }
  if (error instanceof OracleReadinessError) {
    return {
      body: errorResult(
        "mcp_error",
        "Oracle readiness validation is temporarily unavailable.",
      ),
      status: 503,
    };
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
  if (error instanceof OracleMcpResponseSizeError) {
    return {
      body: errorResult(
        "invalid_mcp_response",
        "Oracle returned data that failed the frozen contract or response bounds.",
      ),
      status: 502,
    };
  }
  if (error instanceof OracleMcpTransportError) {
    if (timeoutLike(error)) {
      return {
        body: errorResult(
          "timeout",
          "The grounded query exceeded its bounded server deadline.",
        ),
        status: 504,
      };
    }
    return {
      body: errorResult("mcp_error", "Oracle MCP could not complete the request."),
      status: 503,
    };
  }
  const gateway = gatewayTransportMetadata(error);
  if (gateway?.statusCode === 402) {
    return {
      body: errorResult(
        "ai_budget_unavailable",
        "The AI Gateway budget is currently unavailable.",
      ),
      status: 402,
    };
  }
  if (gateway?.statusCode === 429) {
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
  if (gateway?.statusCode === 503) {
    return {
      body: errorResult(
        "ai_temporarily_unavailable",
        "The configured AI model or provider is temporarily unavailable.",
      ),
      status: 503,
    };
  }
  if (gateway?.statusCode === 401 || gateway?.statusCode === 403) {
    return {
      body: errorResult(
        "ai_authentication_failed",
        "AI Gateway authentication or authorization failed.",
      ),
      status: 503,
    };
  }
  if (gateway?.type === "model_not_found") {
    return {
      body: errorResult(
        "ai_model_unavailable",
        "The configured AI model slug is malformed or unavailable.",
      ),
      status: 503,
    };
  }
  if (gateway?.type === "invalid_request_error" || gateway?.statusCode === 400) {
    return {
      body: errorResult(
        "ai_configuration_error",
        "AI Gateway rejected the configured request.",
      ),
      status: 503,
    };
  }
  if (timeoutLike(error)) {
    return {
      body: errorResult(
        "timeout",
        "The grounded query exceeded its bounded server deadline.",
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
  const ensureReadiness = dependencies.ensureReadiness ?? ensureOracleReadiness;
  const acquireSession = dependencies.acquireSession ?? acquireAgentSession;
  const runAgent = dependencies.runAgent ?? runGroundedAgent;
  const reportError = dependencies.recordError ?? recordServerError;
  const reportSuccess = dependencies.recordSuccess ?? recordServerQuerySuccess;

  return async function queryPost(request: Request): Promise<Response> {
    const startedAt = performance.now();
    const requestId = createRequestId();
    const routeSignal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(QUERY_ROUTE_DEADLINE_MS),
    ]);
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
      const execution: { value: AgentExecutionTelemetry | null } = { value: null };
      const oracleClient = createOracle(config.oracle);
      await ensureReadiness(config.oracle, oracleClient, routeSignal);
      const grounded = await runAgent({
        model: model.model,
        oracleClient,
        nodeEnvironment: config.nodeEnvironment,
        sessionIdHash: session.sessionIdHash,
        request: input,
        abortSignal: routeSignal,
        bounds: agentBoundsForOracleTimeout(config.oracle.oracleMcpTimeoutMs),
        requestedProvider: model.provider,
        requestedModel: model.modelId,
        onTelemetry: (value) => {
          execution.value = value;
        },
        ...(dependencies.referenceTokenSource
          ? {
              _internal: {
                referenceTokenSource: dependencies.referenceTokenSource,
              },
            }
          : {}),
      });
      if (!execution.value) {
        throw Object.assign(new Error("Successful agent execution omitted telemetry."), {
          name: "AgentTelemetryUnavailableError",
        });
      }
      const telemetry = execution.value;
      const metadata: QuerySuccessMetadata = {
        ...telemetry,
        requestId,
        queryLatencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        completion: grounded.status,
        attribution: {
          kind: "hashed_anonymous_session",
          tags: agentGatewayTags(config.nodeEnvironment),
        },
      };
      const result: NaturalLanguageQueryResult = {
        status: "complete",
        grounded,
        metadata,
      };
      reportSuccess(successLogEvent(metadata, session.sessionIdHash));
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
      const initializationStage = oracleReadinessStage(error);
      reportError({
        requestId,
        operation: "grounded_property_query",
        errorClass: sanitizedErrorClass(error),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(initializationStage ? { initializationStage } : {}),
      });
      const body =
        classified.body.status === "error"
          ? {
              ...classified.body,
              error: { ...classified.body.error, requestId },
            }
          : classified.body;
      return jsonResponse(
        body,
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
