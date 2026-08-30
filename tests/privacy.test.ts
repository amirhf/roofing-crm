import { describe, expect, it } from "vitest";

import { createPrivacySafeModelContext } from "../src/agent/privacy";
import type { NaturalLanguageQueryRequest } from "../src/agent/schemas";

const productionRequest =
  "Find the nearest published Pasco properties with a roof-age proxy of at least 15 years. Summarize why they may be roofing opportunities, clearly distinguish proxy data from actual roof age, and state that permit coverage is unavailable.";
const simpleRequest = "Find roofing opportunities with a roof age of at least 15 years.";
const placeholderRequest =
  "Find properties within 8 miles of the selected center with roofs at least 18 years old and an open roofing permit for 45+ days.";

function request(query: string): NaturalLanguageQueryRequest {
  return {
    query,
    searchContext: {
      county: "pasco",
      center: { kind: "coordinates", latitude: 28.1234567, longitude: -82.7654321 },
      radius: { value: 10, unit: "mi" },
      filters: {},
    },
  };
}

describe("privacy-safe query canonicalization", () => {
  it.each([
    [productionRequest, [{ kind: "years", value: 15, unit: "years" }]],
    [simpleRequest, [{ kind: "years", value: 15, unit: "years" }]],
    [
      placeholderRequest,
      [
        { kind: "distance", value: 8, unit: "mi" },
        { kind: "years", value: 18, unit: "years" },
        { kind: "days", value: 45, unit: "days" },
      ],
    ],
  ])("accepts a production-safe request: %s", (query, measurements) => {
    const context = createPrivacySafeModelContext(request(query));

    expect(context).toMatchObject({
      center: "server_held",
      intent: {
        kind: "roofing_opportunity_search",
        measurements,
      },
    });
    expect(JSON.stringify(context)).not.toContain(query);
    expect(JSON.stringify(context)).not.toContain("28.1234567");
    expect(JSON.stringify(context)).not.toContain("-82.7654321");
  });

  it("canonicalizes safe thresholds and sorting without caller prose", () => {
    const query =
      "Find the nearest 10 properties within 12 miles with roof age at least 20 years and permits open for 60 days, sorted by distance ascending.";
    const context = createPrivacySafeModelContext(request(query));

    expect(context.intent).toEqual({
      kind: "roofing_opportunity_search",
      terms: expect.arrayContaining([
        "search",
        "distance_sort",
        "radius_constraint",
        "roof",
        "roof_age",
        "minimum",
        "permit",
        "open_permit",
        "sort",
        "ascending",
      ]),
      measurements: [
        { kind: "result_limit", value: 10, unit: "results" },
        { kind: "distance", value: 12, unit: "mi" },
        { kind: "years", value: 20, unit: "years" },
        { kind: "days", value: 60, unit: "days" },
      ],
    });
    expect(JSON.stringify(context)).not.toContain(query);
  });
});
