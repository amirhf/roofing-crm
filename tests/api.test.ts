import { APICallError } from "@ai-sdk/provider";
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayNotFoundError,
  GatewayRateLimitError,
  GatewayResponseError,
} from "@ai-sdk/gateway";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import searchRequest from "../contracts/fixtures/search-request.json";
import searchResponse from "../contracts/fixtures/search-response.json";
import { createQueryPostHandler } from "../src/agent/http";
import { GET as getLead, PATCH as patchLead } from "../src/app/api/leads/[leadId]/route";
import { GET as listLeads, POST as postLead } from "../src/app/api/leads/route";
import { POST as search } from "../src/app/api/search/route";
import { POST as query } from "../src/app/api/query/route";
import { resetLeadRepositoryForTests } from "../src/crm/repository-factory";
import { AgentConfigurationError } from "../src/config/agent";
import { loadApplicationRuntimeConfig } from "../src/config/runtime";
import { DevelopmentFixtureOracleClient } from "../src/oracle/fixture-adapter";
import {
  OracleMcpResponseSizeError,
  OracleMcpTransportError,
} from "../src/oracle/mcp-transport";
import type { SearchArguments } from "../src/oracle/types";

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

const queryInput = {
  query: "Find older roofs near Zephyrhills",
  searchContext: {
    county: "pasco" as const,
    center: { kind: "place" as const, text: "Pasco County, Florida" },
    radius: { value: 10, unit: "mi" as const },
    filters: {},
  },
};

function configuredTestRuntime() {
  return loadApplicationRuntimeConfig({
    NODE_ENV: "test",
    ORACLE_DATA_SOURCE: "fixtures",
    LEAD_REPOSITORY: "memory",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    AI_PROVIDER: "gateway",
    AI_MODEL: "openai/gpt-5-mini",
  });
}

function apiCallFailure(
  statusCode: number,
  responseHeaders?: Record<string, string>,
): APICallError {
  return new APICallError({
    message: "Gateway request failed",
    url: "https://ai-gateway.vercel.sh/v1/ai/language-model",
    requestBodyValues: {},
    statusCode,
    ...(responseHeaders === undefined ? {} : { responseHeaders }),
    responseBody: "{}",
  });
}

function handlerFailingWith(error: Error, release?: () => void) {
  const config = configuredTestRuntime();
  const model = new MockLanguageModelV4();
  return createQueryPostHandler({
    loadConfig: () => config,
    createModel: () => ({ provider: "mock", modelId: "test/mock", model }),
    createOracle: () => new DevelopmentFixtureOracleClient("test"),
    ...(release ? { acquireSession: () => release } : {}),
    runAgent: async () => {
      throw error;
    },
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

  it("returns an honest model-not-configured state without a live call", async () => {
    const response = await query(request("/api/query", "POST", queryInput));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_configured",
    });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("serves a grounded query through the API with an injected mock model", async () => {
    const input = searchRequest.arguments as unknown as SearchArguments;
    const property = searchResponse.result.data.opportunities[0]!.property;
    const usage = {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "api-search",
              toolName: "prism_v1_search_roofing_opportunities",
              input: JSON.stringify(input),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        },
        {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "grounded",
                filters: input,
                propertyIds: [property.propertyId],
                evidenceRefs: [property.evidence[0]!.evidenceId],
                missingFields: [],
                failure: null,
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        },
      ],
    });
    const release = vi.fn();
    const config = configuredTestRuntime();
    const handler = createQueryPostHandler({
      loadConfig: () => config,
      createModel: () => ({ provider: "mock", modelId: "test/mock", model }),
      createOracle: () => new DevelopmentFixtureOracleClient("test"),
      acquireSession: () => release,
    });

    const response = await handler(request("/api/query", "POST", queryInput));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "complete",
      grounded: {
        status: "grounded",
        propertyIds: [property.propertyId],
        properties: [{ propertyId: property.propertyId }],
      },
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[0]?.providerOptions).toMatchObject({
      gateway: {
        user: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        tags: ["feature:grounded-property-query", "env:test"],
      },
    });
    const attribution = JSON.stringify(model.doGenerateCalls[0]?.providerOptions);
    expect(attribution).not.toContain("roofline_session");
    expect(attribution).not.toContain(queryInput.query);
    expect(attribution).not.toContain("Pasco County, Florida");
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "HTTP 402 budget exhaustion",
      error: new GatewayResponseError({
        statusCode: 402,
        cause: apiCallFailure(402),
      }),
      status: 402,
      code: "ai_budget_unavailable",
    },
    {
      name: "HTTP 503 provider outage",
      error: new GatewayInternalServerError({
        statusCode: 503,
        cause: apiCallFailure(503),
      }),
      status: 503,
      code: "ai_temporarily_unavailable",
    },
    {
      name: "Gateway authentication failure",
      error: new GatewayAuthenticationError({
        statusCode: 401,
        cause: apiCallFailure(401),
      }),
      status: 503,
      code: "ai_authentication_failed",
    },
    {
      name: "unavailable model slug",
      error: new GatewayModelNotFoundError({
        statusCode: 404,
        cause: apiCallFailure(404),
      }),
      status: 503,
      code: "ai_model_unavailable",
    },
    {
      name: "Gateway invalid request",
      error: new GatewayInvalidRequestError({
        statusCode: 400,
        cause: apiCallFailure(400),
      }),
      status: 503,
      code: "ai_configuration_error",
    },
    {
      name: "non-model Gateway route not found",
      error: new GatewayNotFoundError({
        statusCode: 404,
        cause: apiCallFailure(404),
      }),
      status: 502,
      code: "model_error",
    },
  ] as const)("maps $name through the structured boundary", async (testCase) => {
    const response = await handlerFailingWith(testCase.error)(
      request("/api/query", "POST", queryInput),
    );
    expect(response.status).toBe(testCase.status);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      error: { code: testCase.code },
    });
  });

  it.each([
    ["45", 45],
    ["900", 300],
    ["0x10", undefined],
    ["1e2", undefined],
    ["1.5", undefined],
    ["not-a-date", undefined],
  ] as const)(
    "maps HTTP 429 and safely bounds Retry-After %s",
    async (retryAfter, expectedSeconds) => {
      const error = new GatewayRateLimitError({
        cause: apiCallFailure(429, { "retry-after": retryAfter }),
      });
      const response = await handlerFailingWith(error)(
        request("/api/query", "POST", queryInput),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe(
        expectedSeconds === undefined ? null : String(expectedSeconds),
      );
      const payload = (await response.json()) as {
        error: { code: string; retryAfterSeconds?: number };
      };
      expect(payload.error.code).toBe("ai_rate_limited");
      expect(payload.error.retryAfterSeconds).toBe(expectedSeconds);
    },
  );

  it("accepts a standard HTTP-date Retry-After and bounds it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T00:00:00.000Z"));
    try {
      const error = new GatewayRateLimitError({
        cause: apiCallFailure(429, {
          "retry-after": "Sat, 29 Aug 2026 00:10:00 GMT",
        }),
      });
      const response = await handlerFailingWith(error)(
        request("/api/query", "POST", queryInput),
      );
      expect(response.headers.get("retry-after")).toBe("300");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ai_rate_limited", retryAfterSeconds: 300 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps MCP transport failures out of Gateway error mapping and releases the gate", async () => {
    const release = vi.fn();
    const cause = Object.assign(new Error("upstream unavailable"), {
      statusCode: 503,
    });
    const response = await handlerFailingWith(
      new OracleMcpTransportError("Oracle MCP call failed.", { cause }),
      release,
    )(request("/api/query", "POST", queryInput));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "mcp_error" },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("maps a pre-parse oversized MCP response to the invalid-response boundary", async () => {
    const response = await handlerFailingWith(
      new OracleMcpResponseSizeError("Oracle MCP HTTP response was too large."),
    )(request("/api/query", "POST", queryInput));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_mcp_response" },
    });
  });

  it("releases the process-local gate after a timeout", async () => {
    const release = vi.fn();
    const timeout = new DOMException("Tool timed out.", "TimeoutError");
    const response = await handlerFailingWith(
      timeout,
      release,
    )(request("/api/query", "POST", queryInput));
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "timeout" },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("maps malformed model and missing agent configuration without a model call", async () => {
    const malformed = createQueryPostHandler({
      loadConfig: () =>
        loadApplicationRuntimeConfig({
          NODE_ENV: "test",
          ORACLE_DATA_SOURCE: "fixtures",
          LEAD_REPOSITORY: "memory",
          SESSION_SECRET: "0123456789abcdef0123456789abcdef",
          AI_PROVIDER: "gateway",
          AI_MODEL: "openai/not/a-slug",
        }),
    });
    const malformedResponse = await malformed(request("/api/query", "POST", queryInput));
    expect(malformedResponse.status).toBe(503);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      error: { code: "ai_model_unavailable" },
    });

    const unconfigured = createQueryPostHandler({
      loadConfig: () => {
        throw new AgentConfigurationError("AI provider credentials are unavailable.");
      },
    });
    const configResponse = await unconfigured(request("/api/query", "POST", queryInput));
    expect(configResponse.status).toBe(503);
    await expect(configResponse.json()).resolves.toMatchObject({
      error: { code: "ai_configuration_error" },
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
