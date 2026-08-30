import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  AGENT_ORACLE_TOOL_ALLOWLIST,
  runGroundedAgent,
} from "../../src/agent/grounded-agent";
import type {
  AgentModelSearchArguments,
  AgentSearchArguments,
} from "../../src/agent/schemas";
import type {
  AgentModelOutput,
  NaturalLanguageQueryRequest,
} from "../../src/agent/types";
import {
  GET as getLead,
  PATCH as patchLead,
} from "../../src/app/api/leads/[leadId]/route";
import { GET as listLeads, POST as postLead } from "../../src/app/api/leads/route";
import { resetLeadRepositoryForTests } from "../../src/crm/repository-factory";
import { ContractValidatingOracleClient } from "../../src/oracle/client";
import { StreamableHttpOracleMcpTransport } from "../../src/oracle/mcp-transport";
import {
  ORACLE_MCP_TOOL_NAMES,
  type OracleResult,
  type RoofingOpportunity,
  type SearchArguments,
  type SearchResultData,
} from "../../src/oracle/types";

const MCP_URL = process.env.ORACLE_MCP_URL ?? "http://127.0.0.1:9090/mcp";
const HEALTH_URL = new URL("/health", MCP_URL).toString();
const ACTIVE_HASH = "9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131";
const MISSING_COORDINATE_PROPERTY_ID =
  process.env.REAL_MCP_MISSING_COORDINATE_PROPERTY_ID;
const SESSION_SECRET = "local-real-mcp-integration-session-secret";
const SESSION_ID_HASH = `sha256:${"a".repeat(64)}` as const;
const origin = "http://127.0.0.1:3101";
const transport = new StreamableHttpOracleMcpTransport(new URL(MCP_URL));
const oracle = new ContractValidatingOracleClient(transport, "development");

function modelSensitiveValues(property: RoofingOpportunity["property"]): string[] {
  return [
    ...(property.folio.availability === "available" ? [property.folio.value] : []),
    ...(property.address.availability === "available" ? [property.address.value] : []),
    ...(property.coordinates.availability === "available"
      ? [
          String(property.coordinates.value.latitude),
          String(property.coordinates.value.longitude),
        ]
      : []),
    ...(property.ownership.currentOwners.availability === "available"
      ? property.ownership.currentOwners.value.map((owner) => owner.displayName)
      : []),
    ...(property.ownership.publicMailingAddress.availability === "available"
      ? [
          property.ownership.publicMailingAddress.value.addressLines,
          property.ownership.publicMailingAddress.value.locality,
          property.ownership.publicMailingAddress.value.region,
          property.ownership.publicMailingAddress.value.postalCode,
        ].flatMap((fact) =>
          fact.availability === "available"
            ? Array.isArray(fact.value)
              ? fact.value
              : [fact.value]
            : [],
        )
      : []),
    ...(property.ownership.phone.availability === "available"
      ? [property.ownership.phone.value]
      : []),
    ...(property.ownership.email.availability === "available"
      ? [property.ownership.email.value]
      : []),
    ...property.permits.flatMap((permit) =>
      permit.contractor.availability === "available"
        ? [
            permit.contractor.value.name,
            ...(permit.contractor.value.licenseNumber
              ? [permit.contractor.value.licenseNumber]
              : []),
          ]
        : [],
    ),
  ];
}

const searchInput: SearchArguments = {
  county: "pasco",
  center: { kind: "coordinates", latitude: 28.3232, longitude: -82.4319 },
  radius: { value: 50, unit: "mi" },
  filters: {
    roofAge: { operator: "gte", years: 0, basis: "direct_or_proxy" },
    permit: { roofingOnly: true, openOnly: false, minOpenDays: 0 },
    matchMode: "any",
  },
  sort: "distance_asc",
  page: { limit: 2 },
};

const modelSearchInput: AgentSearchArguments = {
  radius: searchInput.radius,
  filters: searchInput.filters,
  sort: searchInput.sort,
  page: { limit: searchInput.page.limit },
};

const modelReportedSearchInput: AgentModelSearchArguments = {
  radius: searchInput.radius,
  filters: {
    roofAge: searchInput.filters.roofAge ?? null,
    permit: {
      roofingOnly: true,
      openOnly: false,
      minOpenDays: 0,
    },
    ownership: null,
    freshness: null,
    matchMode: "any",
  },
  sort: searchInput.sort,
  page: { limit: searchInput.page.limit, continuation: null },
  asOf: null,
};

let firstPage: Extract<OracleResult<SearchResultData>, { ok: true }>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected a structured MCP object.");
  }
  return value as Record<string, unknown>;
}

function apiRequest(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Request {
  const headers = new Headers({ Origin: origin });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function generated(
  content: LanguageModelV4GenerateResult["content"],
  finishReason: LanguageModelV4GenerateResult["finishReason"]["unified"],
): LanguageModelV4GenerateResult {
  return {
    content,
    finishReason: { unified: finishReason, raw: undefined },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

function toolCall(input: AgentSearchArguments): LanguageModelV4GenerateResult {
  return generated(
    [
      {
        type: "tool-call",
        toolCallId: "real-mcp-search",
        toolName: "prism_v1_search_roofing_opportunities",
        input: JSON.stringify(input),
      },
    ],
    "tool-calls",
  );
}

function finish(output: AgentModelOutput): LanguageModelV4GenerateResult {
  return generated([{ type: "text", text: JSON.stringify(output) }], "stop");
}

beforeAll(async () => {
  let response: Response;
  try {
    response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `Real MCP integration is unavailable at ${MCP_URL}. The opt-in suite requires the local Oracle MCP to be running.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Real MCP integration health check failed with HTTP ${response.status}.`,
    );
  }

  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ORACLE_DATA_SOURCE", "mcp");
  vi.stubEnv("ORACLE_MCP_URL", MCP_URL);
  vi.stubEnv("LEAD_REPOSITORY", "memory");
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);

  const result = await oracle.searchRoofingOpportunities(searchInput, {
    timeoutMs: 10_000,
  });
  if (!result.ok) throw new Error("The real MCP search did not return success.");
  if (result.data.opportunities.length === 0) {
    throw new Error("The real MCP search returned no bounded Pasco properties.");
  }
  firstPage = result;
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetLeadRepositoryForTests();
});

describe("real Oracle MCP interoperability", () => {
  it("initializes and advertises exactly the six frozen tools in order", async () => {
    await expect(transport.listToolNames({ timeoutMs: 5_000 })).resolves.toEqual(
      ORACLE_MCP_TOOL_NAMES,
    );
  });

  it("reports the active v1.2 contract and 25,000-property coverage", async () => {
    const service = await oracle.getServiceInfo({ timeoutMs: 5_000 });
    expect(service).toMatchObject({
      ok: true,
      data: {
        contractVersion: "1.2.0",
        activeContractHash: ACTIVE_HASH,
        county: "pasco",
        supportedTools: ORACLE_MCP_TOOL_NAMES,
      },
      meta: { contractVersion: "1.2.0", schemaHash: ACTIVE_HASH },
    });

    const summary = await oracle.getPipelineRunSummary({}, { timeoutMs: 5_000 });
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    const data = object(summary.data);
    const reconciliation = object(data.reconciliationCounts);
    const coverage = object(data.coverage);
    const properties = object(coverage.properties);
    const coordinates = object(coverage.coordinates);
    expect(reconciliation.canonicalProperties).toBe(25_000);
    expect(properties.available).toBe(25_000);
    expect(coordinates.unavailable).toBe(5);

    const querySchema = await oracle.getQuerySchema({ timeoutMs: 5_000 });
    expect(querySchema.ok).toBe(true);
    if (!querySchema.ok) return;
    const coverageSemantics = object(object(querySchema.data).coverageSemantics);
    expect(object(coverageSemantics.coordinates)).toMatchObject({
      missingExcludedFromRadius: true,
      directLookupPreservesUnavailable: true,
    });
  });

  it("returns only non-fixture, coordinate-bearing radius results with explicit proxy and unavailable coverage", async () => {
    expect(firstPage.meta).toMatchObject({
      contractVersion: "1.2.0",
      schemaHash: ACTIVE_HASH,
    });
    expect(JSON.stringify(firstPage)).not.toMatch(/fixture:\/\/|FIXTURE-|ev_fixture_/i);
    expect(
      firstPage.data.opportunities.every(
        ({ property }) => property.coordinates.availability === "available",
      ),
    ).toBe(true);
    expect(
      firstPage.data.opportunities.some(
        ({ property }) =>
          property.roofAgeSignal.availability === "available" &&
          property.roofAgeSignal.value.basis === "year_built_proxy" &&
          property.roofAgeSignal.value.basisQuality === "proxy",
      ),
    ).toBe(true);
    expect(
      firstPage.data.opportunities.some(
        ({ property }) =>
          property.openRoofingPermitCount.availability === "unavailable" &&
          property.maximumOpenRoofingPermitDays.availability === "unavailable",
      ),
    ).toBe(true);
  });

  it("uses stable opaque pagination and direct property lookup", async () => {
    expect(firstPage.meta.nextCursor).toEqual(expect.any(String));
    const second = await oracle.searchRoofingOpportunities(
      {
        ...searchInput,
        page: { ...searchInput.page, cursor: firstPage.meta.nextCursor! },
      },
      { timeoutMs: 10_000 },
    );
    const replay = await oracle.searchRoofingOpportunities(searchInput, {
      timeoutMs: 10_000,
    });
    expect(second.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!second.ok || !replay.ok) return;
    const firstIds = firstPage.data.opportunities.map(
      ({ property }) => property.propertyId,
    );
    const secondIds = second.data.opportunities.map(
      ({ property }) => property.propertyId,
    );
    expect(secondIds).not.toEqual(firstIds);
    expect(replay.data.opportunities.map(({ property }) => property.propertyId)).toEqual(
      firstIds,
    );

    const propertyId = firstPage.data.opportunities[0]!.property.propertyId;
    const direct = await oracle.getProperty({ propertyId }, { timeoutMs: 5_000 });
    expect(direct).toMatchObject({
      ok: true,
      data: { propertyId },
      meta: { contractVersion: "1.2.0", schemaHash: ACTIVE_HASH },
    });
  });

  it.runIf(MISSING_COORDINATE_PROPERTY_ID)(
    "preserves an unavailable coordinate fact on direct lookup",
    async () => {
      if (!MISSING_COORDINATE_PROPERTY_ID) return;
      expect(MISSING_COORDINATE_PROPERTY_ID).toMatch(/^prop_[a-f0-9]{32}$/);
      const direct = await oracle.getProperty(
        { propertyId: MISSING_COORDINATE_PROPERTY_ID as `prop_${string}` },
        { timeoutMs: 5_000 },
      );
      expect(direct.ok).toBe(true);
      if (!direct.ok) return;
      expect(direct.data.coordinates).toMatchObject({
        availability: "unavailable",
        value: null,
      });
    },
  );
});

describe("mock model with real MCP", () => {
  it("grounds only the allowed tool result without exposing owner/contact attribution", async () => {
    const opportunity = firstPage.data.opportunities.find(
      ({ property }) =>
        property.ownership.phone.availability === "unavailable" &&
        property.ownership.email.availability === "unavailable",
    );
    expect(opportunity).toBeDefined();
    const property = opportunity!.property;
    if (
      property.ownership.phone.availability !== "unavailable" ||
      property.ownership.email.availability !== "unavailable"
    ) {
      throw new Error("Expected explicit unavailable contact facts.");
    }
    const evidenceId = property.evidence[0]!.evidenceId;
    const output: AgentModelOutput = {
      status: "grounded",
      filters: modelReportedSearchInput,
      propertyIds: [property.propertyId],
      evidenceRefs: [evidenceId],
      missingFields: [
        {
          propertyId: property.propertyId,
          permitId: null,
          field: "ownership.phone",
          reason: property.ownership.phone.reason,
        },
        {
          propertyId: property.propertyId,
          permitId: null,
          field: "ownership.email",
          reason: property.ownership.email.reason,
        },
      ],
      failure: null,
    };
    const model = new MockLanguageModelV4({
      doGenerate: [toolCall(modelSearchInput), finish(output)],
    });
    const search = vi.spyOn(oracle, "searchRoofingOpportunities");
    const request: NaturalLanguageQueryRequest = {
      query: "Find nearby older roofs with explicit unavailable data.",
      searchContext: {
        county: "pasco",
        center: searchInput.center,
        radius: searchInput.radius,
        filters: searchInput.filters,
      },
    };

    const result = await runGroundedAgent({
      model,
      oracleClient: oracle,
      nodeEnvironment: "development",
      sessionIdHash: SESSION_ID_HASH,
      request,
    });

    expect(search).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)).toEqual(
      AGENT_ORACLE_TOOL_ALLOWLIST,
    );
    expect(model.doGenerateCalls[0]?.providerOptions).toEqual({
      gateway: {
        user: SESSION_ID_HASH,
        tags: ["feature:grounded-property-query", "env:development"],
      },
    });
    const modelTraffic = JSON.stringify(model.doGenerateCalls);
    const sensitiveValues = modelSensitiveValues(property);
    expect(
      sensitiveValues
        .filter((value) => value.length >= 6)
        .some((value) => modelTraffic.includes(value)),
    ).toBe(false);
    expect(result.propertyIds).toEqual([property.propertyId]);
    expect(result.evidenceRefs).toEqual([evidenceId]);
    expect(result.properties[0]?.ownership.phone.availability).toBe("unavailable");
    expect(result.properties[0]?.ownership.email.availability).toBe("unavailable");
  });
});

describe("real MCP lead provenance with development memory persistence", () => {
  it("creates, deduplicates, reads, updates, and session-isolates a v1.2 lead", async () => {
    resetLeadRepositoryForTests();
    const opportunity: RoofingOpportunity = firstPage.data.opportunities[0]!;
    const input = {
      propertyId: opportunity.property.propertyId,
      permitId: opportunity.property.permits[0]?.permitId ?? null,
    };
    const createdResponse = await postLead(apiRequest("/api/leads", "POST", input));
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      lead: Record<string, unknown> & { leadId: string };
    };
    expect(created.lead).toMatchObject({
      contractVersion: "1.1.0",
      oracleContractVersion: "1.2.0",
      oracleContractHash: ACTIVE_HASH,
      propertyId: input.propertyId,
    });
    ["ownership", "currentOwners", "publicMailingAddress", "phone", "email"].forEach(
      (field) => expect(created.lead).not.toHaveProperty(field),
    );
    const cookie = createdResponse.headers.get("set-cookie")!.split(";", 1)[0]!;

    const duplicate = await postLead(apiRequest("/api/leads", "POST", input, cookie));
    await expect(duplicate.json()).resolves.toMatchObject({
      lead: { leadId: created.lead.leadId },
    });

    const context = { params: Promise.resolve({ leadId: created.lead.leadId }) };
    const read = await getLead(
      apiRequest(`/api/leads/${created.lead.leadId}`, "GET", undefined, cookie),
      context,
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      lead: {
        leadId: created.lead.leadId,
        oracleContractVersion: "1.2.0",
        oracleContractHash: ACTIVE_HASH,
      },
    });
    const updated = await patchLead(
      apiRequest(
        `/api/leads/${created.lead.leadId}`,
        "PATCH",
        { status: "qualified", notes: "Synthetic integration note" },
        cookie,
      ),
      context,
    );
    await expect(updated.json()).resolves.toMatchObject({
      lead: {
        status: "qualified",
        notes: "Synthetic integration note",
        oracleContractVersion: "1.2.0",
        oracleContractHash: ACTIVE_HASH,
      },
    });

    const otherSession = await listLeads(apiRequest("/api/leads", "GET"));
    const otherCookie = otherSession.headers.get("set-cookie")!.split(";", 1)[0]!;
    const isolated = await getLead(
      apiRequest(`/api/leads/${created.lead.leadId}`, "GET", undefined, otherCookie),
      context,
    );
    expect(isolated.status).toBe(404);

    const forged = await postLead(
      apiRequest("/api/leads", "POST", {
        ...input,
        oracleContractVersion: "1.0.0",
        oracleContractHash:
          "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
      }),
    );
    expect(forged.status).toBe(400);
  });
});
