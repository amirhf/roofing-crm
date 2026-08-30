"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import type { OracleResult, SearchArguments, SearchResultData } from "@/oracle/types";

import { LeadWorkspace } from "./lead-workspace";
import type { MapPoint } from "./opportunity-map";
import { PropertyDetails } from "./property-details";
import { QueryPanel } from "./query-panel";

const OpportunityMap = dynamic(() => import("./opportunity-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading Pasco map…</div>,
});

const PASCO_CENTER: MapPoint = { latitude: 28.3232, longitude: -82.4319 };

type View = "explore" | "leads" | "query";
type SearchState = "idle" | "loading" | "success" | "empty" | "invalid" | "error";
type PermitCoverage = "available" | "unavailable" | "unknown";

function RoofMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 42">
      <path d="M5 22.4 21 8l16 14.4v11.1H26.8V23h-11v10.5H5V22.4Z" />
      <path d="m11 20.4 10-8.9 10 8.9" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

function Navigation({
  view,
  onView,
}: Readonly<{ view: View; onView: (view: View) => void }>) {
  const enabled: readonly { view: View; label: string }[] = [
    { view: "explore", label: "Explore" },
    { view: "leads", label: "Leads" },
    { view: "query", label: "Query" },
  ];
  const future = ["Territories", "Campaigns", "Reports"];
  return (
    <>
      <a
        className="brand"
        href="#main-content"
        aria-label="Roofline home"
        onClick={() => onView("explore")}
      >
        <span className="brand-mark">
          <RoofMark />
        </span>
        <span>
          <strong>Roofline</strong>
          <small>by Prism</small>
        </span>
      </a>
      <nav className="navigation" aria-label="Primary navigation">
        <p className="eyebrow">Workspace</p>
        {enabled.map((item, index) => (
          <button
            className={view === item.view ? "nav-item active" : "nav-item"}
            type="button"
            aria-current={view === item.view ? "page" : undefined}
            onClick={() => onView(item.view)}
            key={item.view}
          >
            <span className="nav-number">0{index + 1}</span>
            {item.label}
          </button>
        ))}
        {future.map((label, index) => (
          <button
            className="nav-item"
            type="button"
            disabled
            title={`${label} is planned`}
            key={label}
          >
            <span className="nav-number">0{index + 4}</span>
            {label}
            <span className="soon">Soon</span>
          </button>
        ))}
      </nav>
      <div className="rail-note">
        <span className="status-dot" />
        <p>
          Oracle workspace<small>Validated MCP boundary</small>
        </p>
      </div>
    </>
  );
}

export function RoofingCrm() {
  const [view, setView] = useState<View>("explore");
  const [center, setCenter] = useState<MapPoint>(PASCO_CENTER);
  const [latitude, setLatitude] = useState(String(PASCO_CENTER.latitude));
  const [longitude, setLongitude] = useState(String(PASCO_CENTER.longitude));
  const [radius, setRadius] = useState(15);
  const [roofAge, setRoofAge] = useState(15);
  const [openPermits, setOpenPermits] = useState(false);
  const [minOpenDays, setMinOpenDays] = useState(30);
  const [permitCoverage, setPermitCoverage] = useState<PermitCoverage>("unknown");
  const [locationMessage, setLocationMessage] = useState(
    "Click the map or enter coordinates to place the search pin.",
  );
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchMessage, setSearchMessage] = useState(
    "Ready to search the validated Oracle boundary.",
  );
  const [result, setResult] = useState<OracleResult<SearchResultData> | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [lastSearchInput, setLastSearchInput] = useState<SearchArguments | null>(null);
  const [pagePending, setPagePending] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [leadPending, setLeadPending] = useState(false);
  const [leadMessage, setLeadMessage] = useState<string | null>(null);
  const [leadRefreshKey, setLeadRefreshKey] = useState(0);
  const detailsRef = useRef<HTMLElement>(null);
  const searchGenerationRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      searchGenerationRef.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
    },
    [],
  );

  const opportunities = useMemo(
    () => (result?.ok ? result.data.opportunities : []),
    [result],
  );
  const selected =
    opportunities.find(({ property }) => property.propertyId === selectedPropertyId) ??
    null;

  function invalidateSearchResults() {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    searchGenerationRef.current += 1;
    setLastSearchInput(null);
    setPaginationError(null);
    setPagePending(false);
    setResult(null);
    setSelectedPropertyId(null);
    setSearchState("idle");
    setSearchMessage("Search inputs changed. Run a new Oracle search.");
  }

  function updateCenter(next: MapPoint, message: string) {
    invalidateSearchResults();
    setCenter(next);
    setLatitude(next.latitude.toFixed(6));
    setLongitude(next.longitude.toFixed(6));
    setLocationMessage(message);
  }

  function chooseCurrentLocation() {
    if (!navigator.geolocation) {
      updateCenter(
        PASCO_CENTER,
        "Location is unavailable. Using the Pasco County fallback center.",
      );
      return;
    }
    setLocationMessage("Requesting your current location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateCenter(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          "Current location selected. Search facts will still be resolved by Oracle.",
        );
      },
      () => {
        updateCenter(
          PASCO_CENTER,
          "Location permission was denied. Using the Pasco County fallback center; you can place a pin manually.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function applyCoordinates() {
    const next = { latitude: Number(latitude), longitude: Number(longitude) };
    if (
      !Number.isFinite(next.latitude) ||
      !Number.isFinite(next.longitude) ||
      next.latitude < -90 ||
      next.latitude > 90 ||
      next.longitude < -180 ||
      next.longitude > 180
    ) {
      setLocationMessage("Enter a valid latitude and longitude.");
      return;
    }
    updateCenter(next, "Coordinate center selected.");
  }

  function buildSearchInput(): SearchArguments {
    return {
      county: "pasco",
      center: { kind: "coordinates", ...center },
      radius: { value: radius, unit: "mi" },
      filters: {
        roofAge: { operator: "gte", years: roofAge, basis: "direct_or_proxy" },
        ...(openPermits
          ? {
              permit: {
                roofingOnly: true,
                openOnly: true,
                ...(permitCoverage === "available" ? { minOpenDays } : {}),
              },
            }
          : {}),
        matchMode: "all",
      },
      sort:
        openPermits && permitCoverage === "available"
          ? "permit_open_days_desc"
          : "distance_asc",
      page: { limit: 10 },
    };
  }

  async function performSearch(
    input: SearchArguments,
    options: Readonly<{
      append: boolean;
      generation: number;
      controller: AbortController;
    }>,
  ) {
    if (options.append) {
      setPagePending(true);
      setPaginationError(null);
    } else {
      setSearchState("loading");
      setSearchMessage("Oracle search is running…");
      setLeadMessage(null);
      setResult(null);
      setSelectedPropertyId(null);
      setPaginationError(null);
    }

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: options.controller.signal,
      });
      const payload = (await response.json()) as
        OracleResult<SearchResultData> | { error: { code: string; message: string } };
      if (options.generation !== searchGenerationRef.current) return;
      if (!response.ok) {
        const error =
          "error" in payload
            ? payload.error
            : { code: "oracle_unavailable", message: "Search failed." };
        if (options.append) {
          setPaginationError(error.message);
        } else {
          setSearchState(
            error.code === "invalid_contract" || error.code === "schema_hash_mismatch"
              ? "invalid"
              : "error",
          );
          setSearchMessage(error.message);
        }
        return;
      }
      const oracleResult = payload as OracleResult<SearchResultData>;
      if (!oracleResult.ok) {
        if (options.append) {
          setPaginationError("Oracle could not load the next result page.");
        } else {
          setSearchState("error");
          setSearchMessage(oracleResult.error.message);
        }
        return;
      }
      const existing = options.append && result?.ok ? result.data.opportunities : [];
      const seen = new Set(existing.map(({ property }) => property.propertyId));
      const additions = oracleResult.data.opportunities.filter(
        ({ property }) => !seen.has(property.propertyId),
      );
      const combined = [...existing, ...additions];
      if (combined.length > 0) {
        setPermitCoverage(
          combined.some(
            ({ property }) =>
              property.openRoofingPermitCount.availability === "available",
          )
            ? "available"
            : "unavailable",
        );
      }
      setResult({
        ...oracleResult,
        data: { ...oracleResult.data, opportunities: combined },
      });
      if (!options.append) {
        setSelectedPropertyId(combined[0]?.property.propertyId ?? null);
      }
      if (combined.length === 0) {
        setSearchState("empty");
        setSearchMessage(
          input.filters.permit
            ? "Oracle returned no results for the explicit permit filter. Permit coverage may be unavailable; unavailable was not treated as zero."
            : "No opportunities matched these Oracle-resolved filters.",
        );
      } else {
        setSearchState("success");
        setSearchMessage(
          `${combined.length} ${combined.length === 1 ? "opportunity" : "opportunities"} returned.`,
        );
      }
    } catch {
      if (options.generation !== searchGenerationRef.current) return;
      if (options.controller.signal.aborted) return;
      if (options.append) {
        setPaginationError("The next Oracle result page could not be loaded.");
      } else {
        setSearchState("error");
        setSearchMessage("The Oracle MCP boundary could not be reached. Try again.");
      }
    } finally {
      if (searchAbortRef.current === options.controller) {
        searchAbortRef.current = null;
      }
      if (options.generation === searchGenerationRef.current) {
        setPagePending(false);
      }
    }
  }

  async function runSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildSearchInput();
    const generation = searchGenerationRef.current + 1;
    searchGenerationRef.current = generation;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setLastSearchInput(input);
    await performSearch(input, { append: false, generation, controller });
  }

  async function loadNextPage() {
    if (!lastSearchInput || !result?.ok || !result.meta.nextCursor || pagePending) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    await performSearch(
      {
        ...lastSearchInput,
        page: { ...lastSearchInput.page, cursor: result.meta.nextCursor },
      },
      { append: true, generation: searchGenerationRef.current, controller },
    );
  }

  function selectOpportunity(propertyId: string) {
    setSelectedPropertyId(propertyId);
    requestAnimationFrame(() => detailsRef.current?.focus());
  }

  async function createSelectedLead() {
    if (!selected || !result?.ok) return;
    setLeadPending(true);
    setLeadMessage(null);
    const property = selected.property;
    const input = {
      propertyId: property.propertyId,
      permitId: property.permits[0]?.permitId ?? null,
    };
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Lead could not be created.");
      setLeadMessage("Lead created in this anonymous session.");
      setLeadRefreshKey((value) => value + 1);
    } catch (error) {
      setLeadMessage(
        error instanceof Error ? error.message : "Lead could not be created.",
      );
    } finally {
      setLeadPending(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="side-rail">
        <Navigation view={view} onView={setView} />
      </aside>
      <section className="main-panel" id="main-content">
        {view === "explore" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Pasco County, Florida</p>
                <h1>Find the roofs that need attention.</h1>
              </div>
              <div className="county-chip">
                <PinIcon />
                <span>
                  Search territory<strong>Pasco County</strong>
                </span>
              </div>
            </header>
            <div className="explore-layout">
              <form className="search-panel" onSubmit={(event) => void runSearch(event)}>
                <div className="section-heading">
                  <p className="eyebrow">Opportunity search</p>
                  <h2>Choose a center</h2>
                  <p>Drop a map pin, use GPS, or enter coordinates.</p>
                </div>
                <div className="center-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={chooseCurrentLocation}
                  >
                    Use current location
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateCenter(PASCO_CENTER, "Pasco County center selected.")
                    }
                  >
                    Use Pasco center
                  </button>
                </div>
                <div className="coordinate-fields">
                  <label>
                    Latitude
                    <input
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      value={latitude}
                      onChange={(event) => {
                        invalidateSearchResults();
                        setLatitude(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      value={longitude}
                      onChange={(event) => {
                        invalidateSearchResults();
                        setLongitude(event.target.value);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={applyCoordinates}
                    aria-label="Use entered coordinates"
                  >
                    Set
                  </button>
                </div>
                <p className="field-help" aria-live="polite">
                  {locationMessage}
                </p>
                <fieldset className="filter-fieldset">
                  <legend>Qualification filters</legend>
                  <label>
                    Radius{" "}
                    <span>
                      <input
                        type="number"
                        min={0.1}
                        max={50}
                        step={0.1}
                        value={radius}
                        onChange={(event) => {
                          invalidateSearchResults();
                          setRadius(Number(event.target.value));
                        }}
                      />{" "}
                      miles
                    </span>
                  </label>
                  <label>
                    Minimum roof age{" "}
                    <span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={roofAge}
                        onChange={(event) => {
                          invalidateSearchResults();
                          setRoofAge(Number(event.target.value));
                        }}
                      />{" "}
                      years
                    </span>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={openPermits}
                      disabled={permitCoverage === "unavailable"}
                      onChange={(event) => {
                        invalidateSearchResults();
                        setOpenPermits(event.target.checked);
                      }}
                    />
                    <span>Require an open roofing permit</span>
                  </label>
                  <label>
                    Minimum permit-open duration{" "}
                    <span>
                      <input
                        type="number"
                        min={0}
                        max={36500}
                        step={1}
                        value={minOpenDays}
                        disabled={!openPermits || permitCoverage !== "available"}
                        onChange={(event) => {
                          invalidateSearchResults();
                          setMinOpenDays(Number(event.target.value));
                        }}
                      />{" "}
                      days
                    </span>
                  </label>
                  <p className="boundary-copy" aria-live="polite">
                    {permitCoverage === "unavailable"
                      ? "Permit coverage is unavailable for the returned Oracle dataset. Permit-specific filters remain disabled."
                      : permitCoverage === "unknown"
                        ? "Permit coverage is not yet confirmed. Run the default search before applying permit-specific duration filters."
                        : "Permit coverage is available for the returned Oracle records."}
                  </p>
                </fieldset>
                <button
                  className="primary-button search-button"
                  type="submit"
                  disabled={searchState === "loading" || pagePending}
                >
                  {searchState === "loading"
                    ? "Searching Oracle…"
                    : "Search opportunities"}
                </button>
                <p className={`search-status ${searchState}`} aria-live="polite">
                  {searchMessage}
                </p>
                <p className="boundary-copy">
                  Distance, age, permit duration, and eligibility are computed only by
                  Oracle.
                </p>
              </form>

              <section className="map-results" aria-label="Map and search results">
                <div className="map-frame">
                  <OpportunityMap
                    center={center}
                    opportunities={opportunities}
                    selectedPropertyId={selectedPropertyId}
                    onCenterChange={(next) =>
                      updateCenter(next, "Map pin selected as the search center.")
                    }
                    onSelect={selectOpportunity}
                  />
                  <div className="map-instruction">Click map to place search pin</div>
                </div>
                <div className="result-strip" aria-label="Opportunity results">
                  <div className="result-heading">
                    <span>Oracle results</span>
                    <strong>{opportunities.length}</strong>
                  </div>
                  {searchState === "loading" ? (
                    <div className="skeleton-list" aria-label="Loading results">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                  {opportunities.map((opportunity) => (
                    <button
                      type="button"
                      className={
                        opportunity.property.propertyId === selectedPropertyId
                          ? "result-card selected"
                          : "result-card"
                      }
                      key={opportunity.property.propertyId}
                      data-property-id={opportunity.property.propertyId}
                      onClick={() => selectOpportunity(opportunity.property.propertyId)}
                    >
                      <span className="result-signal">
                        {opportunity.property.roofAgeSignal.availability === "available"
                          ? `${opportunity.property.roofAgeSignal.value.ageYears} yr ${
                              opportunity.property.roofAgeSignal.value.basis ===
                              "year_built_proxy"
                                ? "year-built proxy"
                                : "roof signal"
                            }`
                          : "Roof signal unavailable"}
                      </span>
                      <strong>
                        {opportunity.property.address.availability === "available"
                          ? opportunity.property.address.value
                          : opportunity.property.propertyId}
                      </strong>
                      <small>
                        {opportunity.matchReasons.join(" · ").replaceAll("_", " ")}
                      </small>
                    </button>
                  ))}
                  {result?.ok && result.meta.nextCursor ? (
                    <button
                      type="button"
                      className="secondary-button load-more-button"
                      onClick={() => void loadNextPage()}
                      disabled={pagePending}
                    >
                      {pagePending ? "Loading next page…" : "Load next 10 results"}
                    </button>
                  ) : null}
                  {paginationError ? (
                    <p className="pagination-error" role="alert">
                      {paginationError}
                    </p>
                  ) : null}
                  {searchState === "empty" ? (
                    <div className="result-empty">
                      <strong>No matches</strong>
                      <p>
                        {openPermits
                          ? "Permit coverage may be unavailable. Clear the explicit permit filter before interpreting an empty result set."
                          : "Try widening the Oracle search inputs."}
                      </p>
                    </div>
                  ) : null}
                  {searchState === "invalid" ? (
                    <div className="result-error">
                      <strong>Invalid Oracle response</strong>
                      <p>The response was rejected before rendering.</p>
                    </div>
                  ) : null}
                  {searchState === "error" ? (
                    <div className="result-error">
                      <strong>MCP unavailable</strong>
                      <p>No fixture fallback was selected automatically.</p>
                    </div>
                  ) : null}
                </div>
              </section>
              <PropertyDetails
                ref={detailsRef}
                opportunity={selected}
                leadPending={leadPending}
                leadMessage={leadMessage}
                onCreateLead={() => void createSelectedLead()}
              />
            </div>
          </>
        ) : view === "leads" ? (
          <LeadWorkspace refreshKey={leadRefreshKey} />
        ) : (
          <QueryPanel />
        )}
      </section>
    </main>
  );
}
