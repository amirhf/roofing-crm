// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import searchFixture from "../contracts/fixtures/search-response.json";
import permitFixture from "../contracts/fixtures/permit-response.json";
import { RoofingCrm } from "../src/components/roofing-crm";
import type {
  OracleResult,
  RoofingOpportunity,
  SearchArguments,
  SearchResultData,
} from "../src/oracle/types";

interface FakeMapProps {
  readonly opportunities: readonly RoofingOpportunity[];
  readonly selectedPropertyId: string | null;
  readonly onCenterChange: (center: { latitude: number; longitude: number }) => void;
  readonly onSelect: (propertyId: string) => void;
}

vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMap({
      opportunities,
      selectedPropertyId,
      onCenterChange,
      onSelect,
    }: FakeMapProps) {
      return (
        <div aria-label="Test map">
          <button
            type="button"
            onClick={() => onCenterChange({ latitude: 28.5, longitude: -82.5 })}
          >
            Place test pin
          </button>
          {opportunities.map(({ property }) =>
            property.coordinates.availability === "available" ? (
              <button
                type="button"
                aria-pressed={selectedPropertyId === property.propertyId}
                key={property.propertyId}
                onClick={() => onSelect(property.propertyId)}
              >
                Map marker {property.propertyId}
              </button>
            ) : null,
          )}
        </div>
      );
    },
}));

function twoOpportunityResult(): OracleResult<SearchResultData> {
  const result = structuredClone(searchFixture.result) as unknown as Extract<
    OracleResult<SearchResultData>,
    { ok: true }
  >;
  const first = result.data.opportunities[0]!;
  const second = structuredClone(first) as RoofingOpportunity;
  Object.assign(second.property, {
    propertyId: "prop_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    address: { ...second.property.address, value: "200 SECOND TEST WAY, PASCO, FL" },
  });
  return {
    ...result,
    data: { ...result.data, opportunities: [first, second] },
  };
}

describe("primary workflow components", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends typed center and filter inputs and synchronizes map, list, and detail selection", async () => {
    const user = userEvent.setup();
    const response = twoOpportunityResult();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);

    await user.click(screen.getByRole("button", { name: "Place test pin" }));
    const radius = screen.getByRole("spinbutton", { name: "Radius miles" });
    await user.clear(radius);
    await user.type(radius, "12");
    const roofAge = screen.getByRole("spinbutton", {
      name: "Minimum roof age years",
    });
    await user.clear(roofAge);
    await user.type(roofAge, "20");
    expect(
      screen.getByRole("checkbox", { name: "Require an open roofing permit" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      county: "pasco",
      center: { kind: "coordinates", latitude: 28.5, longitude: -82.5 },
      radius: { value: 12, unit: "mi" },
      filters: {
        roofAge: { operator: "gte", years: 20, basis: "direct_or_proxy" },
        matchMode: "all",
      },
      sort: "distance_asc",
    });
    expect((body.filters as Record<string, unknown>).permit).toBeUndefined();
    expect(
      screen.getByRole("spinbutton", {
        name: "Minimum permit-open duration days",
      }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole("button", {
        name: "Map marker prop_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "200 SECOND TEST WAY, PASCO, FL" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /200 SECOND TEST WAY/ })).toHaveClass(
      "selected",
    );
  });

  it("enables permit duration only after Oracle records prove permit coverage", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(twoOpportunityResult()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);

    const permitFilter = screen.getByRole("checkbox", {
      name: "Require an open roofing permit",
    });
    const duration = screen.getByRole("spinbutton", {
      name: "Minimum permit-open duration days",
    });
    expect(permitFilter).not.toBeChecked();
    expect(duration).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    await screen.findByText(
      "Permit coverage is available for the returned Oracle records.",
    );
    await user.click(permitFilter);
    expect(duration).toBeEnabled();
    await user.clear(duration);
    await user.type(duration, "45");
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));

    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body),
    ) as SearchArguments;
    expect(body.filters.permit).toEqual({
      roofingOnly: true,
      openOnly: true,
      minOpenDays: 45,
    });
    expect(body.sort).toBe("permit_open_days_desc");
  });

  it("disables permit filters and renders unavailable coverage without zero claims", async () => {
    const user = userEvent.setup();
    const response = twoOpportunityResult() as Extract<
      OracleResult<SearchResultData>,
      { ok: true }
    >;
    for (const { property } of response.data.opportunities) {
      Object.assign(property, {
        openRoofingPermitCount: {
          availability: "unavailable",
          value: null,
          class: "derived",
          reason: "source_unavailable",
          evidenceRefs: [],
        },
      });
    }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);

    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    expect(
      await screen.findByText(
        "Permit coverage is unavailable for the returned Oracle dataset. Permit-specific filters remain disabled.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Require an open roofing permit" }),
    ).toBeDisabled();
    expect(screen.getByText(/Permit coverage is unavailable:/i)).toBeInTheDocument();
    expect(screen.queryByText(/zero permit/i)).not.toBeInTheDocument();
  });

  it("appends cursor pages and invalidates results when search inputs change", async () => {
    const user = userEvent.setup();
    const first = twoOpportunityResult() as Extract<
      OracleResult<SearchResultData>,
      { ok: true }
    >;
    const nextOpportunity = structuredClone(
      first.data.opportunities[0]!,
    ) as RoofingOpportunity;
    Object.assign(nextOpportunity.property, {
      propertyId: "prop_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      address: { ...nextOpportunity.property.address, value: "300 THIRD WAY, PASCO, FL" },
    });
    const second = {
      ...first,
      data: { ...first.data, opportunities: [nextOpportunity] },
      meta: { ...first.meta, nextCursor: null },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...first, meta: { ...first.meta, nextCursor: "cursor_2" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(second), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    await user.click(screen.getByRole("button", { name: "Load next 10 results" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const nextBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[1]![1]!.body),
    ) as SearchArguments;
    expect(nextBody.page).toEqual({ limit: 10, cursor: "cursor_2" });
    expect(
      screen.getAllByRole("button", { name: /TEST WAY|SECOND TEST WAY|THIRD WAY/ }),
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: /Map marker prop_b+/ }),
    ).toBeInTheDocument();

    const radius = screen.getByRole("spinbutton", { name: "Radius miles" });
    await user.clear(radius);
    await user.type(radius, "9");
    expect(screen.queryByRole("button", { name: /THIRD WAY/ })).not.toBeInTheDocument();
    expect(
      screen.getByText("Search inputs changed. Run a new Oracle search."),
    ).toBeInTheDocument();
  });

  it("aborts a deferred page request and re-enables search when inputs change", async () => {
    const user = userEvent.setup();
    const first = twoOpportunityResult() as Extract<
      OracleResult<SearchResultData>,
      { ok: true }
    >;
    let pageSignal: AbortSignal | undefined;
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...first, meta: { ...first.meta, nextCursor: "cursor_2" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            pageSignal = init?.signal ?? undefined;
            pageSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("Page request aborted.", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(first), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    await user.click(screen.getByRole("button", { name: "Load next 10 results" }));
    expect(screen.getByRole("button", { name: "Loading next page…" })).toBeDisabled();

    const radius = screen.getByRole("spinbutton", { name: "Radius miles" });
    await user.clear(radius);
    await user.type(radius, "9");

    await waitFor(() => expect(pageSignal?.aborted).toBe(true));
    const search = screen.getByRole("button", { name: "Search opportunities" });
    expect(search).toBeEnabled();
    await user.click(search);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(await screen.findByText("2 opportunities returned.")).toBeInTheDocument();
  });

  it("renders partial-data and provenance unavailable states explicitly", async () => {
    const user = userEvent.setup();
    const partialResponse = structuredClone(searchFixture.result) as unknown as {
      data: {
        opportunities: Array<{
          property: {
            ownership: {
              publicMailingAddress: {
                value: { locality: unknown };
              };
            };
          };
        }>;
      };
    };
    partialResponse.data.opportunities[0]!.property.ownership.publicMailingAddress.value.locality =
      {
        availability: "unavailable",
        value: null,
        class: "raw",
        reason: "source_unavailable",
        evidenceRefs: [],
      };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(partialResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    expect(await screen.findByText("Partial data")).toBeInTheDocument();
    expect(
      screen.getByText(/Contractor and BBB values are unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByText("No public evidence link available")).toBeInTheDocument();
    expect(screen.getByText("2 current owners")).toBeInTheDocument();
    expect(screen.getByText("Public mailing address")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    const classification = screen.getByText("Ownership classification").closest("div");
    expect(classification).not.toBeNull();
    expect(
      within(classification!).getByText("Evidence: ev_fixture_appraiser_001"),
    ).toBeInTheDocument();
    const phone = screen.getByText("Phone").closest("div");
    expect(phone).not.toBeNull();
    expect(
      within(phone!).getByText("No evidence identifier returned"),
    ).toBeInTheDocument();
    expect(screen.getByText("Retrieved", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Loaded", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Computed", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText(/Published CID/).length).toBeGreaterThan(0);
    const locality = screen.getByText("Locality").closest("li");
    expect(locality).not.toBeNull();
    expect(within(locality!).getByText("Source unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(/source reported and not independently verified/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Year built proxy · proxy (not actual roof age)"),
    ).toBeInTheDocument();
  });

  it("renders permit fact evidence and every freshness dimension", async () => {
    const user = userEvent.setup();
    const response = structuredClone(searchFixture.result) as unknown as Extract<
      OracleResult<SearchResultData>,
      { ok: true }
    >;
    const property = response.data.opportunities[0]!.property as unknown as {
      permits: unknown[];
    };
    property.permits = [structuredClone(permitFixture.result.data)];
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    expect(await screen.findByText("Open state")).toBeInTheDocument();
    expect(screen.getByText("Roofing relevance")).toBeInTheDocument();
    expect(screen.getAllByText("Evidence: ev_fixture_permit_001").length).toBeGreaterThan(
      3,
    );
    expect(screen.getAllByText("Observed", { exact: true }).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Published", { exact: true }).length).toBeGreaterThan(1);
    expect(screen.getAllByText("Source cadence", { exact: true }).length).toBeGreaterThan(
      1,
    );
  });

  it.each([
    [422, "invalid_contract", "Invalid Oracle response"],
    [503, "oracle_unavailable", "MCP unavailable"],
  ])("shows the %s response state", async (status, code, heading) => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: "Boundary failed." } }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    expect(await screen.findByText(heading)).toBeInTheDocument();
  });
});
