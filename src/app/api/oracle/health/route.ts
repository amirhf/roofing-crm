import { loadOracleRuntimeConfig } from "@/config/oracle";
import { EXPECTED_MCP_SCHEMA_SHA256 } from "@/oracle/contracts";
import { createOracleClient } from "@/oracle/factory";
import { ensureOracleReadiness, oracleReadinessStage } from "@/oracle/readiness";
import {
  createRequestId,
  recordServerError,
  sanitizedErrorClass,
} from "@/server/error-telemetry";
import { jsonResponse } from "@/server/request-context";
import { classifyOracleSearchError } from "@/server/oracle-search-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 65;
const HEALTH_ROUTE_DEADLINE_MS = 60_000;

export async function GET(request?: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const config = loadOracleRuntimeConfig(process.env);
    const timeoutSignal = AbortSignal.timeout(HEALTH_ROUTE_DEADLINE_MS);
    const readiness = await ensureOracleReadiness(
      config,
      createOracleClient(config),
      request ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal,
    );
    return jsonResponse(readiness, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const requestId = createRequestId();
    const initializationStage = oracleReadinessStage(error);
    const classification = classifyOracleSearchError(error);
    recordServerError({
      requestId,
      operation: "oracle_readiness",
      errorClass:
        classification.errorClass === "UnknownError"
          ? sanitizedErrorClass(error)
          : classification.errorClass,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      attemptCount: 1,
      statusCategory: classification.statusCategory,
      ...(initializationStage ? { initializationStage } : {}),
    });
    return jsonResponse(
      {
        ready: false,
        error: {
          code: "oracle_unavailable",
          message: "Oracle readiness validation is temporarily unavailable.",
          requestId,
        },
        contractVersion: "1.2.0",
        schemaHash: EXPECTED_MCP_SCHEMA_SHA256,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
