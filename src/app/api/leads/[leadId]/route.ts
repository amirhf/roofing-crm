import { LeadInputError, parseUpdateLeadInput, updateLead } from "@/crm/service";
import { createLeadRequestContext, jsonResponse } from "@/server/request-context";
import { assertSameOrigin, SameOriginError } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ leadId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { leadId } = await context.params;
    const { repository, session } = createLeadRequestContext(request);
    const lead = await repository.find(session.sessionIdHash, leadId, new Date());
    if (!lead) {
      return jsonResponse(
        { error: { code: "not_found", message: "Lead not found." } },
        { status: 404 },
        session.setCookieHeader,
      );
    }
    return jsonResponse({ lead }, {}, session.setCookieHeader);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load lead.";
    return jsonResponse(
      { error: { code: "lead_store_error", message } },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = parseUpdateLeadInput(await request.json());
    const { leadId } = await context.params;
    const { repository, session } = createLeadRequestContext(request);
    const lead = await updateLead(repository, session.sessionIdHash, leadId, input);
    if (!lead) {
      return jsonResponse(
        { error: { code: "not_found", message: "Lead not found." } },
        { status: 404 },
        session.setCookieHeader,
      );
    }
    return jsonResponse({ lead }, {}, session.setCookieHeader);
  } catch (error) {
    if (error instanceof LeadInputError || error instanceof SameOriginError) {
      return jsonResponse(
        { error: { code: "invalid_request", message: error.message } },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to update lead.";
    return jsonResponse(
      { error: { code: "lead_store_error", message } },
      { status: 500 },
    );
  }
}
