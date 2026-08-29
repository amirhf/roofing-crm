import {
  createLead,
  LeadInputError,
  LeadOracleProvenanceError,
  LeadOracleUnavailableError,
  parseCreateLeadInput,
  resolveLeadOracleProvenance,
} from "@/crm/service";
import { createOracleClient } from "@/oracle/factory";
import {
  createRequestId,
  recordServerError,
  sanitizedErrorClass,
} from "@/server/error-telemetry";
import { createLeadRequestContext, jsonResponse } from "@/server/request-context";
import { assertSameOrigin, SameOriginError } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const LEAD_ORACLE_TIMEOUT_MS = 10_000;

function reportLeadError(operation: string, error: unknown, startedAt: number): string {
  const requestId = createRequestId();
  recordServerError({
    requestId,
    operation,
    errorClass: sanitizedErrorClass(error),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
  return requestId;
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    const { repository, session } = createLeadRequestContext(request);
    const leads = await repository.list(session.sessionIdHash, new Date());
    return jsonResponse({ leads }, {}, session.setCookieHeader);
  } catch (error) {
    const requestId = reportLeadError("lead_list", error, startedAt);
    return jsonResponse(
      {
        error: {
          code: "lead_store_error",
          message: "Lead storage is temporarily unavailable.",
          requestId,
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const input = parseCreateLeadInput(await request.json());
    const { config, repository, session } = createLeadRequestContext(request);
    const provenance = await resolveLeadOracleProvenance(
      createOracleClient(config.oracle),
      input,
      { signal: request.signal, timeoutMs: LEAD_ORACLE_TIMEOUT_MS },
    );
    const lead = await createLead(
      repository,
      session.sessionIdHash,
      session.expiresAt,
      input,
      provenance,
    );
    return jsonResponse({ lead }, { status: 201 }, session.setCookieHeader);
  } catch (error) {
    if (error instanceof LeadInputError || error instanceof SameOriginError) {
      return jsonResponse(
        { error: { code: "invalid_request", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof LeadOracleProvenanceError) {
      const requestId = reportLeadError("lead_create_provenance", error, startedAt);
      return jsonResponse(
        {
          error: {
            code: "oracle_provenance_invalid",
            message: "Oracle could not validate the requested lead source.",
            requestId,
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof LeadOracleUnavailableError) {
      const requestId = reportLeadError("lead_create_oracle", error, startedAt);
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
    const requestId = reportLeadError("lead_create", error, startedAt);
    return jsonResponse(
      {
        error: {
          code: "lead_store_error",
          message: "Lead storage is temporarily unavailable.",
          requestId,
        },
      },
      { status: 500 },
    );
  }
}
