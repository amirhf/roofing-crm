import { createLead, LeadInputError, parseCreateLeadInput } from "@/crm/service";
import { createLeadRequestContext, jsonResponse } from "@/server/request-context";
import { assertSameOrigin, SameOriginError } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { repository, session } = createLeadRequestContext(request);
    const leads = await repository.list(session.sessionIdHash, new Date());
    return jsonResponse({ leads }, {}, session.setCookieHeader);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load leads.";
    return jsonResponse(
      { error: { code: "lead_store_error", message } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = parseCreateLeadInput(await request.json());
    const { repository, session } = createLeadRequestContext(request);
    const lead = await createLead(
      repository,
      session.sessionIdHash,
      session.expiresAt,
      input,
    );
    return jsonResponse({ lead }, { status: 201 }, session.setCookieHeader);
  } catch (error) {
    if (error instanceof LeadInputError || error instanceof SameOriginError) {
      return jsonResponse(
        { error: { code: "invalid_request", message: error.message } },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to create lead.";
    return jsonResponse(
      { error: { code: "lead_store_error", message } },
      { status: 500 },
    );
  }
}
