import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const searchFixture = JSON.parse(
  readFileSync(
    new URL("../contracts/fixtures/search-response.json", import.meta.url),
    "utf8",
  ),
) as {
  result: {
    data: {
      opportunities: Array<{
        property: {
          propertyId: string;
          evidence: Array<{ evidenceId: string }>;
        };
      }>;
    };
  };
};
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
  await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();
  const map = page.locator(".leaflet-map");
  await map.click({ position: { x: 310, y: 190 } });
  await expect(page.getByText("Map pin selected as the search center.")).toBeVisible();

  await page.getByRole("spinbutton", { name: "Radius miles" }).fill("8");
  await page.getByRole("spinbutton", { name: "Minimum roof age years" }).fill("18");
  await page
    .getByRole("spinbutton", { name: "Minimum permit-open duration days" })
    .fill("45");
  await page.getByRole("button", { name: "Search opportunities" }).click();

  await expect(page.getByText("1 opportunity returned.")).toBeVisible();
  expect(searchRequest).toMatchObject({
    county: "pasco",
    radius: { value: 8, unit: "mi" },
    filters: {
      roofAge: { years: 18, basis: "direct_or_proxy" },
      permit: { openOnly: true, minOpenDays: 45 },
    },
  });
  await expect(
    page.getByRole("heading", {
      name: "100 TEST WAY, FIXTURE ZEPHYRHILLS, FL 33540",
    }),
  ).toBeVisible();
  await expect(page.getByText("year built proxy · proxy")).toBeVisible();
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
  await expect(
    page.getByText(/Permit, contractor, and BBB values are unavailable/),
  ).toBeVisible();
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
          propertyIds: [agentProperty.propertyId],
          evidenceRefs: [agentProperty.evidence[0]!.evidenceId],
          missingFields: [
            {
              propertyId: agentProperty.propertyId,
              permitId: null,
              field: "bbbRating",
              reason: "no_permit_record_returned",
            },
          ],
          failure: null,
          properties: [agentProperty],
          evidence: [agentProperty.evidence[0]],
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
  await expect(
    page.getByRole("heading", {
      name: "100 TEST WAY, FIXTURE ZEPHYRHILLS, FL 33540",
    }),
  ).toBeVisible();
  await expect(page.getByText("ev_fixture_appraiser_001")).toBeVisible();
  await expect(page.getByText("bbbRating")).toBeVisible();
  await page.getByText("Exact MCP search input").click();
  await expect(page.locator("pre")).toContainText('"minOpenDays": 45');
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
