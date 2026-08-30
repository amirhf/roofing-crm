import type { NaturalLanguageQueryRequest } from "./schemas";

import { AgentIntentValidationError, AgentPrivacyError } from "./errors";

const SENSITIVE_CLAUSE_MARKER =
  /\b(?:owner(?:\s+name)?|contact(?:\s+name)?|phone|email|contractor(?:\s+(?:name|id|identifier))?|(?:street|mailing|situs)\s+address|address|folio|parcel(?:\s+(?:id|identifier))?|property\s+(?:id|identifier)|permit\s+(?:number|id|identifier)|latitude|longitude|coordinates?|gps|map\s+pin|pin|cursor|continuation\s+token|credentials?|password|api\s+key|gateway\s+key|oidc(?:\s+token)?|access\s+token|bearer\s+token|secret|database\s+url)\b/i;

const HIGH_RISK_VALUE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:prop|perm)_[a-f0-9]{16,}\b/i,
  /(?:^|\s)[+-]?\d{1,2}\.\d{4,}\s*[,/]\s*[+-]?\d{1,3}\.\d{4,}(?:\s|$)/,
  /\b(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?\d{3}[ .-]?\d{4}\b/,
  /\bP\.?\s*O\.?\s+Box\s+\d+\b/i,
  /\b\d{1,6}\s+[a-z0-9][a-z0-9 .'-]{1,80}\s(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|trail|trl|parkway|pkwy|highway|hwy)\b/i,
  /\b\d{8,}\b/,
  /\b(?:postgres(?:ql)?):\/\/[^\s]+/i,
  /\b(?:sk|key|token)_[a-z0-9_-]{12,}\b/i,
] as const;

const UNSUPPORTED_STORAGE_PATTERN =
  /\b(?:sql|postgres(?:ql)?|neon|duckdb|filebase|ipfs|ipns|filesystem|database|storage|source\s+file)\b/i;

const SAFE_TERMS: Readonly<Record<string, string | null>> = Object.freeze({
  a: null,
  actual: "actual_basis",
  age: "roof_age",
  all: "match_all",
  an: null,
  and: null,
  any: "match_any",
  area: "server_center",
  are: null,
  around: "near_server_center",
  ascending: "ascending",
  at: null,
  bbb: "bbb_availability",
  basis: "roof_basis",
  be: null,
  by: null,
  candidate: "opportunity",
  candidates: "opportunity",
  center: "server_center",
  clearly: null,
  closest: "distance_sort",
  county: "pasco_scope",
  coverage: "coverage_availability",
  data: "data_availability",
  day: null,
  days: null,
  descending: "descending",
  direct: "direct_basis",
  distance: "distance_sort",
  distinguish: "proxy_actual_distinction",
  evidence: "evidence",
  explicit: "explicit_unavailable",
  fields: "data_availability",
  find: "search",
  first: "ascending",
  florida: "pasco_scope",
  for: null,
  from: null,
  has: null,
  have: null,
  home: "property",
  homes: "property",
  house: "property",
  houses: "property",
  include: null,
  including: null,
  is: null,
  km: null,
  kilometer: null,
  kilometers: null,
  least: "minimum",
  limit: "result_limit",
  list: "search",
  longest: "permit_duration_sort",
  match: "matching",
  map: "server_center",
  may: null,
  me: null,
  mi: null,
  mile: null,
  miles: null,
  minimum: "minimum",
  missing: "explicit_unavailable",
  more: "minimum",
  near: "near_server_center",
  nearby: "near_server_center",
  nearest: "distance_sort",
  need: null,
  of: null,
  old: "roof_age",
  older: "roof_age",
  only: "only",
  open: "open_permit",
  opportunities: "opportunity",
  opportunity: "opportunity",
  or: null,
  order: "sort",
  pasco: "pasco_scope",
  permit: "permit",
  permits: "permit",
  please: null,
  preserve: null,
  properties: "property",
  property: "property",
  proxy: "proxy_basis",
  publication: "published_records",
  published: "published_records",
  rating: "bbb_availability",
  ratings: "bbb_availability",
  request: null,
  result: "result_limit",
  results: "result_limit",
  roof: "roof",
  roofing: "roof",
  roofs: "roof",
  search: "search",
  selected: "server_center",
  show: "search",
  sort: "sort",
  sorted: "sort",
  state: null,
  summarize: null,
  sources: "evidence",
  source: "evidence",
  than: null,
  that: null,
  they: null,
  the: null,
  top: "result_limit",
  unavailable: "explicit_unavailable",
  want: null,
  with: null,
  within: "radius_constraint",
  why: null,
  year: null,
  years: null,
});

export interface PrivacySafeModelContext {
  readonly contextVersion: "privacy-safe-v1";
  readonly county: "pasco";
  readonly center: "server_held";
  readonly defaults: Readonly<{
    radius: NaturalLanguageQueryRequest["searchContext"]["radius"];
    filters: NaturalLanguageQueryRequest["searchContext"]["filters"];
  }>;
  readonly intent: Readonly<{
    kind: "roofing_opportunity_search" | "unsupported_storage_request";
    terms: readonly string[];
    measurements: readonly Readonly<{
      kind: "distance" | "years" | "days" | "result_limit";
      value: number;
      unit: "mi" | "km" | "years" | "days" | "results";
    }>[];
  }>;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hideServerSelectedPlace(
  query: string,
  center: NaturalLanguageQueryRequest["searchContext"]["center"],
): string {
  if (center.kind !== "place") return query;
  const candidates = [center.text, ...center.text.split(",")]
    .map((value) => value.trim())
    .filter((value) => value.length >= 3)
    .sort((left, right) => right.length - left.length);
  return candidates.reduce(
    (value, candidate) =>
      value.replace(
        new RegExp(escapeRegularExpression(candidate), "gi"),
        " selected area ",
      ),
    query,
  );
}

function assertNoSensitiveCallerValues(query: string): string {
  for (const clause of query.split(/[;\r\n]+/)) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    if (
      SENSITIVE_CLAUSE_MARKER.test(trimmed) ||
      HIGH_RISK_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed))
    ) {
      throw new AgentPrivacyError();
    }
  }
  if (!query.trim()) throw new AgentIntentValidationError();
  return query;
}

function normalizeIntent(query: string): PrivacySafeModelContext["intent"] {
  if (UNSUPPORTED_STORAGE_PATTERN.test(query)) {
    return {
      kind: "unsupported_storage_request",
      terms: ["unsupported_storage_access"],
      measurements: [],
    };
  }

  const normalized = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /(\d+(?:\.\d+)?)\+\s*(miles?|mi|kilometers?|km|years?|days?)/g,
      "$1 $2 minimum",
    )
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
  const tokens = normalized ? normalized.split(/\s+/) : [];
  const consumedNumbers = new Set<number>();
  const consumedUnits = new Set<number>();
  const measurements: PrivacySafeModelContext["intent"]["measurements"][number][] = [];

  tokens.forEach((token, index) => {
    if (!/^\d+(?:\.\d+)?$/.test(token)) return;
    const value = Number(token);
    const unit = tokens[index + 1];
    if (!Number.isFinite(value) || unit === undefined) {
      throw new AgentIntentValidationError();
    }
    if (["mile", "miles", "mi"].includes(unit)) {
      measurements.push({ kind: "distance", value, unit: "mi" });
    } else if (["kilometer", "kilometers", "km"].includes(unit)) {
      measurements.push({ kind: "distance", value, unit: "km" });
    } else if (["year", "years"].includes(unit)) {
      measurements.push({ kind: "years", value, unit: "years" });
    } else if (["day", "days"].includes(unit)) {
      measurements.push({ kind: "days", value, unit: "days" });
    } else if (
      [
        "result",
        "results",
        "property",
        "properties",
        "home",
        "homes",
        "opportunity",
        "opportunities",
      ].includes(unit)
    ) {
      measurements.push({ kind: "result_limit", value, unit: "results" });
    } else {
      throw new AgentIntentValidationError();
    }
    consumedNumbers.add(index);
    consumedUnits.add(index + 1);
  });
  if (measurements.length > 8) throw new AgentIntentValidationError();

  const terms: string[] = [];
  tokens.forEach((token, index) => {
    if (consumedNumbers.has(index) || consumedUnits.has(index)) return;
    if (/^\d/.test(token) || !(token in SAFE_TERMS)) {
      throw new AgentIntentValidationError();
    }
    const term = SAFE_TERMS[token];
    if (term && !terms.includes(term)) terms.push(term);
  });
  if (
    !terms.some((term) =>
      [
        "search",
        "property",
        "opportunity",
        "roof",
        "roof_age",
        "permit",
        "evidence",
        "bbb_availability",
        "data_availability",
      ].includes(term),
    )
  ) {
    throw new AgentIntentValidationError();
  }

  return { kind: "roofing_opportunity_search", terms, measurements };
}

export function createPrivacySafeModelContext(
  request: NaturalLanguageQueryRequest,
): PrivacySafeModelContext {
  assertNoSensitiveCallerValues(request.query);
  const centerHidden = hideServerSelectedPlace(
    request.query,
    request.searchContext.center,
  );
  const safeQuery = assertNoSensitiveCallerValues(centerHidden);
  return {
    contextVersion: "privacy-safe-v1",
    county: "pasco",
    center: "server_held",
    defaults: {
      radius: request.searchContext.radius,
      filters: request.searchContext.filters,
    },
    intent: normalizeIntent(safeQuery),
  };
}
