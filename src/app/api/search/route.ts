import { loadApplicationRuntimeConfig } from "@/config/runtime";
import {
  assertValidSearchArguments,
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import { createOracleClient } from "@/oracle/factory";
import {
  createRequestId,
  recordServerError,
  sanitizedErrorClass,
} from "@/server/error-telemetry";
import { jsonResponse } from "@/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SEARCH_ORACLE_TIMEOUT_MS = 10_000;

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const input: unknown = await request.json();
    assertValidSearchArguments(input);
    const client = createOracleClient(loadApplicationRuntimeConfig(process.env).oracle);
    const result = await client.searchRoofingOpportunities(input, {
      signal: request.signal,
      timeoutMs: SEARCH_ORACLE_TIMEOUT_MS,
    });
    if (!result.ok) {
      const status = result.error.code === "invalid_argument" ? 400 : 503;
      const requestId = createRequestId();
      recordServerError({
        requestId,
        operation: "oracle_property_search",
        errorClass: "OracleFailure",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
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
    recordServerError({
      requestId,
      operation: "oracle_property_search",
      errorClass: sanitizedErrorClass(error),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
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
