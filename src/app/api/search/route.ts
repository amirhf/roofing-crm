import { loadOracleRuntimeConfig } from "@/config/oracle";
import {
  assertValidSearchArguments,
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import { createOracleClient } from "@/oracle/factory";
import { ensureOracleReadiness, oracleReadinessStage } from "@/oracle/readiness";
import { createRequestId, recordServerError } from "@/server/error-telemetry";
import { classifyOracleSearchError } from "@/server/oracle-search-telemetry";
import { jsonResponse } from "@/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 65;
const SEARCH_ROUTE_DEADLINE_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const routeSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(SEARCH_ROUTE_DEADLINE_MS),
  ]);
  try {
    const input: unknown = await request.json();
    assertValidSearchArguments(input);
    const oracleConfig = loadOracleRuntimeConfig(process.env);
    const client = createOracleClient(oracleConfig);
    await ensureOracleReadiness(oracleConfig, client, routeSignal);
    const result = await client.searchRoofingOpportunities(input, {
      signal: routeSignal,
      timeoutMs: oracleConfig.oracleMcpTimeoutMs,
    });
    if (!result.ok) {
      const status = result.error.code === "invalid_argument" ? 400 : 503;
      const requestId = createRequestId();
      recordServerError({
        requestId,
        operation: "oracle_property_search",
        errorClass: "OracleFailure",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        attemptCount: 1,
        statusCategory: `oracle_${result.error.code}`,
      });
      return jsonResponse(
        {
          error: {
            code: result.error.code,
            message:
              status === 400
                ? "Oracle rejected the search request."
                : "Oracle service is temporarily unavailable.",
            requestId,
          },
        },
        { status },
      );
    }
    return jsonResponse(result);
  } catch (error) {
    const requestId = createRequestId();
    const classification = classifyOracleSearchError(error);
    const initializationStage = oracleReadinessStage(error);
    recordServerError({
      requestId,
      operation: "oracle_property_search",
      errorClass: classification.errorClass,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      attemptCount: 1,
      statusCategory: classification.statusCategory,
      ...(initializationStage ? { initializationStage } : {}),
    });
    if (error instanceof ContractValidationError) {
      return jsonResponse(
        {
          error: {
            code: "invalid_contract",
            message: "The search request or Oracle response did not match MCP v1.2.",
            requestId,
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof OracleSchemaHashMismatchError) {
      return jsonResponse(
        {
          error: {
            code: "schema_hash_mismatch",
            message: "Oracle returned an unexpected MCP contract hash.",
            requestId,
          },
        },
        { status: 502 },
      );
    }
    return jsonResponse(
      {
        error: {
          code: "oracle_unavailable",
          message: "Oracle service is temporarily unavailable.",
          requestId,
        },
      },
      { status: 503 },
    );
  }
}
