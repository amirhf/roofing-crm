// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import searchFixture from "../contracts/fixtures/search-response.json";
import { RoofingCrm } from "../src/components/roofing-crm";
import type {
  OracleResult,
  RoofingOpportunity,
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
          {opportunities.map(({ property }) => (
            <button
              type="button"
              aria-pressed={selectedPropertyId === property.propertyId}
              key={property.propertyId}
              onClick={() => onSelect(property.propertyId)}
            >
              Map marker {property.propertyId}
            </button>
          ))}
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
    await user.click(
      screen.getByRole("checkbox", { name: "Require an open roofing permit" }),
    );
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
        permit: { roofingOnly: true, openOnly: false, minOpenDays: 30 },
      },
      sort: "distance_asc",
    });

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

  it("renders partial-data and provenance unavailable states explicitly", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(searchFixture.result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<RoofingCrm />);
    await user.click(screen.getByRole("button", { name: "Search opportunities" }));
    expect(await screen.findByText("Partial data")).toBeInTheDocument();
    expect(
      screen.getByText(/contractor, and BBB values are unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByText("No public evidence link available")).toBeInTheDocument();
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
