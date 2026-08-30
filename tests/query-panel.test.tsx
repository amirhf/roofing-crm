// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import searchFixture from "../contracts/fixtures/search-response.json";
import type { NaturalLanguageQueryResult } from "../src/agent/types";
import { QueryPanel } from "../src/components/query-panel";
import type { OracleResult, SearchResultData } from "../src/oracle/types";

const oracleResult = searchFixture.result as unknown as Extract<
  OracleResult<SearchResultData>,
  { ok: true }
>;
const property = oracleResult.data.opportunities[0]!.property;
const completeResult: NaturalLanguageQueryResult = {
  status: "complete",
  grounded: {
    status: "grounded",
    answer:
      "Retrieved 1 validated Oracle property. Review the MCP-backed records and evidence below.",
    filters: {
      county: "pasco",
      center: { kind: "place", text: "Zephyrhills, Florida" },
      radius: { value: 8, unit: "mi" },
      filters: {
        roofAge: { operator: "gte", years: 18, basis: "direct_or_proxy" },
        permit: { roofingOnly: true, openOnly: true, minOpenDays: 45 },
      },
      sort: "distance_asc",
      page: { limit: 10 },
    },
    propertyIds: [property.propertyId],
    evidenceRefs: [property.evidence[0]!.evidenceId],
    missingFields: [
      {
        propertyId: property.propertyId,
        permitId: null,
        field: "bbbRating",
        reason: "no_permit_record_returned",
      },
    ],
    failure: null,
    properties: [property],
    evidence: [property.evidence[0]!],
  },
};

describe("grounded query panel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows loading, then factual MCP records, evidence, and unavailable fields", async () => {
    const user = userEvent.setup();
    let resolveResponse!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    render(<QueryPanel />);

    const input = screen.getByLabelText("Natural-language request");
    await user.type(input, "Older roofs near Zephyrhills with open permits");
    await user.click(screen.getByRole("button", { name: "Run grounded query" }));
    expect(screen.getByText("Grounding in progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    resolveResponse(
      new Response(JSON.stringify(completeResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await screen.findByText("Grounding proven")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Candidate publication only. Results are not authoritative-complete Pasco coverage.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "100 TEST WAY, FIXTURE ZEPHYRHILLS, FL 33540",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ev_fixture_appraiser_001")).toBeInTheDocument();
    expect(screen.getByText("bbbRating")).toBeInTheDocument();
    expect(screen.getAllByText("Public link unavailable")).not.toHaveLength(0);
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());

    const requestBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody).toEqual({
      query: "Older roofs near Zephyrhills with open permits",
      searchContext: {
        county: "pasco",
        center: { kind: "coordinates", latitude: 28.3232, longitude: -82.4319 },
        radius: { value: 10, unit: "mi" },
        filters: {},
      },
    });
  });

  it("submits with Ctrl+Enter and renders the honest not-configured state", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "not_configured",
          message: "Set AI_PROVIDER and AI_MODEL, or use structured search.",
        } satisfies NaturalLanguageQueryResult),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<QueryPanel />);
    const input = screen.getByLabelText("Natural-language request");
    await user.type(input, "Show older roofs{Control>}{Enter}{/Control}");
    expect(await screen.findByText("Model not configured")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "Find the nearest published Pasco roofing opportunities within 15 miles with roofs at least 15 years old. Explain the proxy basis and available permit coverage. Return at most 3 results.",
    "Find the nearest properties within 15 miles with roofs at least 15 years old. Return at most 3 results.",
  ])(
    "serializes an exact bounded production query without rewriting it: %s",
    async (query) => {
      const user = userEvent.setup();
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(completeResult), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      render(<QueryPanel />);

      await user.type(screen.getByLabelText("Natural-language request"), query);
      await user.click(screen.getByRole("button", { name: "Run grounded query" }));

      expect(await screen.findByText("Grounding proven")).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledOnce();
      const requestBody = JSON.parse(
        String(vi.mocked(fetch).mock.calls[0]?.[1]?.body),
      ) as Record<string, unknown>;
      expect(requestBody).toEqual({
        query,
        searchContext: {
          county: "pasco",
          center: {
            kind: "coordinates",
            latitude: 28.3232,
            longitude: -82.4319,
          },
          radius: { value: 10, unit: "mi" },
          filters: {},
        },
      });
    },
  );

  it.each([
    ["grounding_rejected", "Unsupported claim rejected"],
    ["timeout", "Query timed out"],
    ["mcp_error", "Oracle MCP unavailable"],
    ["invalid_mcp_response", "Invalid Oracle response"],
    ["ai_budget_unavailable", "AI budget unavailable"],
    ["ai_rate_limited", "AI rate limited"],
    ["ai_temporarily_unavailable", "AI temporarily unavailable"],
    ["ai_authentication_failed", "AI authentication failed"],
    ["ai_configuration_error", "AI configuration error"],
    ["ai_model_unavailable", "AI model unavailable"],
  ] as const)("renders the %s error state accessibly", async (code, heading) => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: { code, message: "The server rejected this test request." },
        } satisfies NaturalLanguageQueryResult),
        { status: code === "timeout" ? 504 : 422 },
      ),
    );
    render(<QueryPanel />);
    await user.type(screen.getByLabelText("Natural-language request"), "Test query");
    await user.click(screen.getByRole("button", { name: "Run grounded query" }));
    expect(await screen.findByText(heading)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });
});
