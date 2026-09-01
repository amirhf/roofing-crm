import { expect, test, type Page } from "@playwright/test";

const mcpUrl = process.env.ORACLE_MCP_URL ?? "http://127.0.0.1:9090/mcp";
const healthUrl = new URL("/health", mcpUrl).toString();

function sanitizedPropertyId(value: string): string {
  if (!/^prop_[a-f0-9]{32}$/.test(value)) {
    throw new Error("The real MCP returned an invalid property identifier.");
  }
  return value;
}

async function resultIds(page: Page): Promise<string[]> {
  return page
    .locator(".result-card")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-property-id") ?? ""),
    );
}

test.beforeAll(async () => {
  let response: Response;
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `Real MCP browser integration is unavailable at ${mcpUrl}. Start the local Oracle MCP before running this opt-in suite.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`Real MCP browser health check failed with HTTP ${response.status}.`);
  }
});

test.beforeEach(async ({ page }) => {
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 204 }),
  );
});

test("real MCP map, ownership labels, and anonymous lead workflow stay synchronized", async ({
  page,
}) => {
  const searchRequests: Array<Record<string, unknown>> = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/api/search") && request.method() === "POST") {
      searchRequests.push(request.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto("/");
  await expect(page.getByText("OpenStreetMap contributors")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Radius miles" }).fill("50");
  await page.getByRole("spinbutton", { name: "Minimum roof age years" }).fill("0");
  await expect(
    page.getByRole("checkbox", { name: "Require an open roofing permit" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("spinbutton", { name: "Minimum permit-open duration days" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.locator(".search-status")).not.toHaveClass(/loading/);
  const defaultFilters = searchRequests[0]!.filters as Record<string, unknown>;
  expect(defaultFilters.permit).toBeUndefined();
  expect(defaultFilters.matchMode).toBe("all");
  expect(searchRequests[0]!.sort).toBe("distance_asc");
  const defaultResultReasons = await page.locator(".result-card small").allTextContents();
  expect(
    defaultResultReasons.every(
      (reason) => reason.includes("roof age") && !reason.includes("open roofing permit"),
    ),
  ).toBe(true);

  await expect(page.locator(".search-status.success")).toContainText(
    /opportunit(?:y|ies) returned/,
  );
  let ids = (await resultIds(page)).map(sanitizedPropertyId);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);

  const nextPage = page.getByRole("button", { name: "Load next 10 results" });
  if (await nextPage.isVisible()) {
    await nextPage.click();
    await expect(page.locator(".result-card")).toHaveCount(20);
    ids = (await resultIds(page)).map(sanitizedPropertyId);
    expect(new Set(ids).size).toBe(ids.length);
  }

  const markers = page.locator(".leaflet-marker-icon[title^='prop_']");
  await expect(markers).toHaveCount(ids.length);
  const markerIds = (
    await markers.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("title") ?? ""),
    )
  ).map(sanitizedPropertyId);
  expect([...markerIds].sort()).toEqual([...ids].sort());

  const listTarget = ids.at(1) ?? ids[0]!;
  await page.locator(`.result-card[data-property-id='${listTarget}']`).click();
  await expect(page.locator(".details-panel .mono-id")).toHaveText(listTarget);
  await expect(page.locator(".details-panel")).toBeFocused();

  const markerTarget = ids[0]!;
  const markerTargetElement = page.locator(
    `.leaflet-marker-icon[title='${markerTarget}']`,
  );
  await markerTargetElement.focus();
  await markerTargetElement.evaluate((element) => (element as HTMLElement).click());
  await expect(page.locator(".details-panel .mono-id")).toHaveText(markerTarget);
  await expect(page.getByText(/year built proxy/i).first()).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Public ownership & contact" }),
  ).toBeVisible();
  await expect(page.getByText("Current owner names")).toBeVisible();
  await expect(page.locator(".owner-count")).toHaveText(/^\d+ current owners?$/);
  await expect(page.getByText("Ownership classification")).toBeVisible();
  await expect(page.getByText("Public mailing address", { exact: true })).toBeVisible();
  await expect(page.getByText("Phone", { exact: true })).toBeVisible();
  await expect(page.getByText("Email", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/source reported and not independently verified/i),
  ).toBeVisible();
  await expect(page.getByText("Retrieved", { exact: true })).toBeVisible();
  await expect(page.getByText("Loaded", { exact: true })).toBeVisible();
  await expect(page.getByText("Computed", { exact: true })).toBeVisible();

  const permitCount = page
    .locator(".detail-grid dt", { hasText: "Open roofing permits" })
    .locator("..")
    .locator("dd");
  if ((await permitCount.textContent())?.includes("Source not collected")) {
    await expect(
      page.getByText(
        /Permit coverage is unavailable.*Contractor and BBB coverage remain unavailable/,
      ),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Lead created in this anonymous session.")).toBeVisible();
  await page.getByRole("button", { name: /Leads/ }).click();
  const leadRow = page.getByRole("button", { name: new RegExp(markerTarget) });
  await expect(leadRow).toBeVisible();
  await leadRow.click();
  await page.getByLabel("Status").selectOption("qualified");
  await page.getByLabel("Notes").fill("Synthetic local integration note");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Lead updated.")).toBeVisible();
  await expect(leadRow).toContainText("qualified");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  consoleErrors.length = 0;

  await page.route("**/api/search", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "oracle_unavailable",
          message: "Synthetic post-lead MCP failure",
        },
      }),
    }),
  );
  await page.getByRole("button", { name: /Explore/ }).click();
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.getByText("MCP unavailable")).toBeVisible();
  await page.getByRole("button", { name: /Leads/ }).click();
  await expect(leadRow).toContainText("qualified");

  const hasNextErrorOverlay = await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    return Boolean(
      portal?.shadowRoot?.querySelector(
        "[data-nextjs-dialog-content], .nextjs-toast-errors-parent",
      ),
    );
  });
  expect(hasNextErrorOverlay).toBe(false);
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.every((message) =>
      message.includes("server responded with a status of 503"),
    ),
  ).toBe(true);
});

test("a real-workflow MCP failure is visible and never replaced by fixtures", async ({
  page,
}) => {
  await page.route("**/api/search", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "oracle_unavailable",
          message: "Synthetic local MCP transport failure",
        },
      }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Search opportunities" }).click();
  await expect(page.getByText("MCP unavailable")).toBeVisible();
  await expect(
    page.getByText("No fixture fallback was selected automatically."),
  ).toBeVisible();
  await expect(page.getByText("Synthetic local MCP transport failure")).toBeVisible();
  await expect(page.locator(".result-card")).toHaveCount(0);
});
