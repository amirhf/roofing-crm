import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import type {
  OracleSuccess,
  PropertyId,
  RoofingOpportunity,
  SearchResultData,
} from "../src/oracle/types";

const searchFixture = JSON.parse(
  readFileSync(
    new URL("../contracts/fixtures/search-response.json", import.meta.url),
    "utf8",
  ),
) as { result: OracleSuccess<SearchResultData> };
const agentProperty = searchFixture.result.data.opportunities[0]!.property;

test.beforeEach(async ({ page }) => {
  await page.route("https://*.tile.openstreetmap.org/**", (route) => route.abort());
});

test("choose center, filter, inspect provenance, create and update a lead", async ({
  page,
}) => {
  let searchRequest: Record<string, unknown> | null = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/search") && request.method() === "POST") {
      searchRequest = request.postDataJSON() as Record<string, unknown>;
    }
  });

  await page.goto("/");
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "roofline_session",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  expect(sessionCookie!.expires - Date.now() / 1000).toBeGreaterThan(6 * 24 * 60 * 60);
  await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();
  const map = page.locator(".leaflet-map");
  await map.click({ position: { x: 310, y: 190 } });
  await expect(page.getByText("Map pin selected as the search center.")).toBeVisible();

  const permitFilter = page.getByRole("checkbox", {
    name: "Require an open roofing permit",
  });
  const permitDuration = page.getByRole("spinbutton", {
    name: "Minimum permit-open duration days",
  });
  await expect(permitFilter).not.toBeChecked();
  await expect(permitDuration).toBeDisabled();
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(
    page.getByText(
      "Permit coverage is unavailable for the returned Oracle dataset. Permit-specific filters remain disabled.",
    ),
  ).toBeVisible();
  await expect(permitFilter).toBeDisabled();

  await page.getByRole("spinbutton", { name: "Radius miles" }).fill("8");
  await page.getByRole("spinbutton", { name: "Minimum roof age years" }).fill("18");
  await page.getByRole("button", { name: "Search opportunities" }).click();

  await expect(page.getByText("1 opportunity returned.")).toBeVisible();
  expect(searchRequest).toMatchObject({
    county: "pasco",
    radius: { value: 8, unit: "mi" },
    filters: {
      roofAge: { years: 18, basis: "direct_or_proxy" },
      matchMode: "all",
    },
  });
  await expect(
    page.getByRole("heading", {
      name: "100 TEST WAY, FIXTURE ZEPHYRHILLS, FL 33540",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Year built proxy · proxy (not actual roof age)"),
  ).toBeVisible();
  await expect(page.getByText("2 current owners")).toBeVisible();
  await expect(page.getByText("Public mailing address", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/source reported and not independently verified/i),
  ).toBeVisible();
  await expect(page.getByText("No public evidence link available")).toBeVisible();

  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Lead created in this anonymous session.")).toBeVisible();
  await page.getByRole("button", { name: /Leads/ }).click();
  const leadRow = page.getByRole("button", {
    name: /prop_e72ba795455c19d71ce4cb11f6177a5e/,
  });
  await expect(leadRow).toBeVisible();
  await leadRow.click();
  await page.getByLabel("Status").selectOption("contacted");
  await page.getByLabel("Notes").fill("Left a voicemail after inspection review.");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Lead updated.")).toBeVisible();
  await expect(leadRow).toContainText("contacted");
});

test("loads bounded cursor pages while keeping map and result IDs synchronized", async ({
  page,
}) => {
  const template = searchFixture.result.data.opportunities[0]!;
  const opportunities = Array.from({ length: 12 }, (_, index) => {
    const opportunity = structuredClone(template) as RoofingOpportunity;
    const suffix = (index + 1).toString(16).padStart(32, "0");
    const propertyId = `prop_${suffix}` as PropertyId;
    const property = opportunity.property as unknown as {
      propertyId: PropertyId;
      address: { value: string };
      permits: Array<{ propertyId: PropertyId }>;
    };
    property.propertyId = propertyId;
    property.address.value = `${index + 1} SYNTHETIC TEST WAY`;
    property.permits.forEach((permit) => {
      permit.propertyId = propertyId;
    });
    return opportunity;
  });
  const cursors: Array<string | undefined> = [];

  await page.route("**/api/search", async (route) => {
    const input = route.request().postDataJSON() as {
      page: { cursor?: string };
    };
    cursors.push(input.page.cursor);
    const response = structuredClone(searchFixture.result) as unknown as {
      data: { opportunities: RoofingOpportunity[] };
      meta: { nextCursor: string | null };
    };
    const secondPage = input.page.cursor === "cursor_page_2";
    response.data.opportunities = secondPage
      ? opportunities.slice(10)
      : opportunities.slice(0, 10);
    response.meta.nextCursor = secondPage ? null : "cursor_page_2";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.locator(".result-card")).toHaveCount(10);
  await expect(page.locator(".map-marker-shell")).toHaveCount(10);

  await page.getByRole("button", { name: "Load next 10 results" }).click();
  await expect(page.locator(".result-card")).toHaveCount(12);
  await expect(page.locator(".map-marker-shell")).toHaveCount(12);
  expect(cursors).toEqual([undefined, "cursor_page_2"]);

  await page.locator(".result-card").last().click();
  await expect(page.getByText(opportunities[11]!.property.propertyId)).toBeVisible();
});

test("geolocation denial keeps a clear Pasco fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
          error({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
          } as GeolocationPositionError),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use current location" }).click();
  await expect(page.getByText(/Location permission was denied/)).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Latitude" })).toHaveValue(
    "28.323200",
  );
});

test("partial data remains explicit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.getByText("Partial data")).toBeVisible();
  await expect(page.getByText(/Contractor and BBB values are unavailable/)).toBeVisible();
  await expect(page.getByText("Not applicable")).toBeVisible();
});

test("MCP failure is visible and never replaced with fixture data", async ({ page }) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "oracle_unavailable", message: "Test MCP outage" },
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.getByText("MCP unavailable")).toBeVisible();
  await expect(
    page.getByText("No fixture fallback was selected automatically."),
  ).toBeVisible();
  await expect(page.getByText("Test MCP outage")).toBeVisible();
});

test("keyboard controls and mobile layout remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Explore/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Leads/ })).toBeFocused();
  await page.getByRole("button", { name: /Explore/ }).click();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await expect(page.getByRole("spinbutton", { name: "Radius miles" })).toBeVisible();
});

test("grounded query renders only validated MCP property and evidence records", async ({
  page,
}) => {
  const propertyRef = `property_ref_${"p".repeat(24)}`;
  const evidenceRef = `evidence_ref_${"e".repeat(24)}`;
  await page.route("**/api/query", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "complete",
        grounded: {
          status: "grounded",
          answer:
            "Retrieved 1 validated Oracle property. Review the MCP-backed records and evidence below.",
          filters: {
            radius: { value: 8, unit: "mi" },
            filters: {
              roofAge: { operator: "gte", years: 18, basis: "direct_or_proxy" },
              permit: { roofingOnly: true, openOnly: true, minOpenDays: 45 },
              ownership: null,
              freshness: null,
              matchMode: "all",
            },
            sort: "distance_asc",
            page: { limit: 10, continuation: false },
            asOf: null,
          },
          propertyRefs: [propertyRef],
          evidenceRefs: [evidenceRef],
          missingFields: [
            {
              propertyRef,
              permitRef: null,
              field: "bbbRating",
              reason: "no_permit_record_returned",
            },
          ],
          failure: null,
          properties: [
            {
              propertyRef,
              county: "pasco",
              yearBuilt: agentProperty.yearBuilt,
              roofInstallationDate: agentProperty.roofInstallationDate,
              roofAgeSignal: agentProperty.roofAgeSignal,
              ownershipDurationYears: agentProperty.ownershipDurationYears,
              openRoofingPermitCount: agentProperty.openRoofingPermitCount,
              maximumOpenRoofingPermitDays: agentProperty.maximumOpenRoofingPermitDays,
              permits: [],
              evidenceRefs: [evidenceRef],
            },
          ],
          evidence: [
            {
              evidenceRef,
              sourceName: agentProperty.evidence[0]!.sourceName,
              observedAt: agentProperty.evidence[0]!.observedAt,
              retrievedAt: agentProperty.evidence[0]!.retrievedAt,
              loadedAt: agentProperty.evidence[0]!.loadedAt,
            },
          ],
        },
        metadata: {
          requestId: "synthetic-browser-request",
          requestedProvider: "mock",
          requestedModel: "test/model",
          sdkResponseModel: { value: "test/model", unavailableReason: null },
          resolvedProvider: { value: null, unavailableReason: "not_observable" },
          resolvedModel: { value: null, unavailableReason: "not_observable" },
          modelGenerations: 2,
          sdkAttemptCount: 2,
          sdkRetryCount: 0,
          providerAttemptCount: { value: null, unavailableReason: "not_observable" },
          oracleToolCallCount: 1,
          queryLatencyMs: 20,
          modelLatencyMs: { value: 10, unavailableReason: null },
          oracleLatencyMs: 5,
          gatewayGenerationTimeMs: {
            value: null,
            unavailableReason: "bounded_lookup_unsupported",
          },
          inputTokens: { value: 20, unavailableReason: null },
          outputTokens: { value: 10, unavailableReason: null },
          totalTokens: { value: 30, unavailableReason: null },
          costUsd: { value: null, unavailableReason: "bounded_lookup_unsupported" },
          finishReason: { value: "stop", unavailableReason: null },
          completion: "grounded",
          attribution: {
            kind: "hashed_anonymous_session",
            tags: ["feature:grounded-property-query", "env:test"],
          },
        },
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Query/ }).click();
  await page
    .getByLabel("Natural-language request")
    .fill("Find older roofs near Zephyrhills with long-open permits");
  await page.getByRole("button", { name: "Run grounded query" }).click();

  await expect(page.getByText("Grounding proven")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Grounded property 1" })).toBeVisible();
  await expect(page.getByText("Contract fixture appraisal source")).toBeVisible();
  await expect(
    page.getByText("Canonical source identifiers stay server-held."),
  ).toBeVisible();
  await expect(page.getByText("bbbRating")).toBeVisible();
  await page.getByText("Exact MCP search input").click();
  await expect(page.locator("pre")).toContainText('"minOpenDays": 45');
  const rendered = await page.locator("body").innerText();
  expect(rendered).not.toContain(agentProperty.propertyId);
  expect(rendered).not.toContain(agentProperty.evidence[0]!.evidenceId);
  expect(rendered).not.toContain("100 TEST WAY");
});

test("query interface is keyboard-usable and honest when no model is configured", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Query/ }).click();
  const input = page.getByLabel("Natural-language request");
  await input.fill("Show me older roofs");
  await input.press("Control+Enter");
  await expect(page.getByText("Model not configured")).toBeVisible();
  await expect(page.getByRole("status")).toBeFocused();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
