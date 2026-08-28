import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import searchRequest from "../contracts/fixtures/search-request.json";
import { GET as getLead, PATCH as patchLead } from "../src/app/api/leads/[leadId]/route";
import { GET as listLeads, POST as postLead } from "../src/app/api/leads/route";
import { POST as search } from "../src/app/api/search/route";
import { resetLeadRepositoryForTests } from "../src/crm/repository-factory";

const origin = "http://localhost:3000";
const createInput = {
  propertyId: "prop_e72ba795455c19d71ce4cb11f6177a5e",
  permitId: null,
  oracleSchemaHash: "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
  sourcePublicationCid: null,
  sourceCapturedAt: "2026-08-28T00:00:00.000Z",
};

function request(path: string, method: string, body?: unknown, cookie?: string): Request {
  const headers = new Headers({ Origin: origin });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("server APIs", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ORACLE_DATA_SOURCE", "fixtures");
    vi.stubEnv("LEAD_REPOSITORY", "memory");
    vi.stubEnv("SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    resetLeadRepositoryForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetLeadRepositoryForTests();
  });

  it("accepts a contract-valid fixture search and rejects invalid inputs", async () => {
    const valid = await search(request("/api/search", "POST", searchRequest.arguments));
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ ok: true });

    const invalid = await search(
      request("/api/search", "POST", { ...searchRequest.arguments, county: "orange" }),
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "invalid_contract" },
    });
  });

  it("creates, lists, reads, and updates a lead through the signed session API", async () => {
    const createdResponse = await postLead(request("/api/leads", "POST", createInput));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { lead: { leadId: string } };
    const cookie = createdResponse.headers.get("set-cookie")!.split(";", 1)[0]!;

    const listedResponse = await listLeads(
      request("/api/leads", "GET", undefined, cookie),
    );
    await expect(listedResponse.json()).resolves.toMatchObject({
      leads: [{ leadId: created.lead.leadId, status: "new" }],
    });

    const context = { params: Promise.resolve({ leadId: created.lead.leadId }) };
    const readResponse = await getLead(
      request(`/api/leads/${created.lead.leadId}`, "GET", undefined, cookie),
      context,
    );
    expect(readResponse.status).toBe(200);

    const updatedResponse = await patchLead(
      request(
        `/api/leads/${created.lead.leadId}`,
        "PATCH",
        { status: "contacted", notes: "Left a voicemail" },
        cookie,
      ),
      context,
    );
    await expect(updatedResponse.json()).resolves.toMatchObject({
      lead: { status: "contacted", notes: "Left a voicemail" },
    });
  });

  it("does not reveal another anonymous session's lead", async () => {
    const createdResponse = await postLead(request("/api/leads", "POST", createInput));
    const created = (await createdResponse.json()) as { lead: { leadId: string } };
    const otherSessionResponse = await listLeads(request("/api/leads", "GET"));
    const otherCookie = otherSessionResponse.headers.get("set-cookie")!.split(";", 1)[0]!;
    const response = await getLead(
      request(`/api/leads/${created.lead.leadId}`, "GET", undefined, otherCookie),
      { params: Promise.resolve({ leadId: created.lead.leadId }) },
    );
    expect(response.status).toBe(404);
  });
});
