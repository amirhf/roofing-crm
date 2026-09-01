export const ORACLE_MCP_TOOL_NAMES = [
  "prism_v1_get_service_info",
  "prism_v1_get_pipeline_run_summary",
  "prism_v1_search_roofing_opportunities",
  "prism_v1_get_property",
  "prism_v1_get_permit",
  "prism_v1_get_query_schema",
] as const;

export type OracleMcpToolName = (typeof ORACLE_MCP_TOOL_NAMES)[number];
export type NodeEnvironment = "development" | "test" | "production";
export type PropertyId = `prop_${string}`;
export type PermitId = `perm_${string}`;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type FactClass = "raw" | "normalized" | "derived" | "inferred";
export type UnavailableReason =
  | "not_provided_by_source"
  | "source_not_collected"
  | "source_unavailable"
  | "not_applicable"
  | "ambiguous_match";

export interface Derivation {
  readonly rule: string;
  readonly ruleVersion: string;
  readonly asOf?: string;
  readonly inputs: readonly string[];
}

export interface AvailableFact<T> {
  readonly availability: "available";
  readonly value: T;
  readonly class: FactClass;
  readonly evidenceRefs: readonly string[];
  readonly derivation?: Derivation;
}

export interface UnavailableFact {
  readonly availability: "unavailable";
  readonly value: null;
  readonly class: FactClass;
  readonly reason: UnavailableReason;
  readonly evidenceRefs: readonly string[];
}

export type Fact<T> = AvailableFact<T> | UnavailableFact;

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly crs: "EPSG:4326";
}

export interface RoofAgeSignal {
  readonly ageYears: number;
  readonly precision: "day" | "year";
  readonly basis:
    | "roof_installation_date"
    | "roof_permit_completion"
    | "final_inspection"
    | "roof_permit_issue"
    | "year_built_proxy";
  readonly basisQuality: "direct" | "proxy";
  readonly asOf: string;
}

export interface Contractor {
  readonly name: string;
  readonly licenseNumber: string | null;
}

export interface OwnerDisplayName {
  readonly displayName: string;
  readonly evidenceRefs: readonly string[];
}

export interface PublicMailingAddress {
  readonly addressLines: Fact<readonly string[]>;
  readonly locality: Fact<string>;
  readonly region: Fact<string>;
  readonly postalCode: Fact<string>;
  readonly country: Fact<string>;
}

export interface OwnerContactPrivacy {
  readonly recordNature: "official_public_record";
  readonly publicationStatus: "approved_for_publication";
  readonly accuracyQualification: "source_reported_not_independently_verified";
}

export interface PublicOwnership {
  readonly currentOwners: Fact<readonly OwnerDisplayName[]>;
  readonly classification: Fact<string>;
  readonly publicMailingAddress: Fact<PublicMailingAddress>;
  readonly phone: Fact<string>;
  readonly email: Fact<string>;
  readonly privacy: OwnerContactPrivacy;
}

export interface Evidence {
  readonly evidenceId: string;
  readonly sourceSystem: string;
  readonly sourceName: string;
  readonly sourceRecordKey: string;
  readonly sourceUrl: string | null;
  readonly sourceArtifactUri: string;
  readonly sourceRecordHash: `sha256:${string}`;
  readonly observedAt: string | null;
  readonly retrievedAt: string;
  readonly loadedAt: string;
  readonly publishedCid: string | null;
}

export interface Freshness {
  readonly observedAt: string | null;
  readonly retrievedAt: string;
  readonly loadedAt: string;
  readonly publishedAt: string | null;
  readonly computedAt: string;
  readonly sourceCadence: string | null;
  readonly cadenceStatus:
    "within_source_cadence" | "past_source_cadence" | "cadence_unknown";
}

export interface Permit {
  readonly permitId: PermitId;
  readonly propertyId: PropertyId;
  readonly permitNumber: Fact<string>;
  readonly status: Fact<string>;
  readonly isOpen: Fact<boolean>;
  readonly openDurationDays: Fact<number>;
  readonly roofingRelevance: Fact<boolean>;
  readonly contractor: Fact<Contractor>;
  readonly bbbRating: Fact<string>;
  readonly evidence: readonly Evidence[];
  readonly freshness: Freshness;
}

export interface Property {
  readonly propertyId: PropertyId;
  readonly county: "pasco";
  readonly folio: Fact<string>;
  readonly address: Fact<string>;
  readonly coordinates: Fact<Coordinates>;
  readonly yearBuilt: Fact<number>;
  readonly roofInstallationDate: Fact<string>;
  readonly roofAgeSignal: Fact<RoofAgeSignal>;
  readonly ownershipDurationYears: Fact<number>;
  readonly ownerArea: Fact<string>;
  readonly ownership: PublicOwnership;
  readonly openRoofingPermitCount: Fact<number>;
  readonly maximumOpenRoofingPermitDays: Fact<number>;
  readonly permits: readonly Permit[];
  readonly evidence: readonly Evidence[];
  readonly freshness: Freshness;
}

export interface OracleResponseMeta {
  readonly contractVersion: "1.2.0";
  readonly schemaHash: string;
  readonly county: "pasco";
  readonly asOf: string;
  readonly artifactCids: readonly string[];
  readonly nextCursor: string | null;
}

export interface OracleErrorMeta {
  readonly contractVersion: "1.2.0";
  readonly schemaHash: string;
  readonly requestId: string;
}

export interface OracleError {
  readonly code:
    | "invalid_argument"
    | "invalid_cursor"
    | "not_found"
    | "county_not_served"
    | "data_unavailable"
    | "dependency_unavailable"
    | "rate_limited"
    | "deadline_exceeded"
    | "internal";
  readonly message: string;
  readonly retryable: boolean;
  readonly dependency?: string;
  readonly details?: JsonObject;
}

export interface OracleSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta: OracleResponseMeta;
}

export interface OracleFailure {
  readonly ok: false;
  readonly error: OracleError;
  readonly meta: OracleErrorMeta;
}

export type OracleResult<T> = OracleSuccess<T> | OracleFailure;

export type SearchCenter =
  | Readonly<{
      kind: "coordinates";
      latitude: number;
      longitude: number;
    }>
  | Readonly<{
      kind: "place";
      text: string;
    }>;

export interface SearchArguments {
  readonly county: "pasco";
  readonly center: SearchCenter;
  readonly radius: Readonly<{ value: number; unit: "mi" | "km" }>;
  readonly filters: Readonly<{
    roofAge?: Readonly<{
      operator: "gt" | "gte";
      years: number;
      basis: "direct_only" | "direct_or_proxy";
    }>;
    permit?: Readonly<{
      roofingOnly?: boolean;
      openOnly?: boolean;
      minOpenDays?: number;
    }>;
    ownership?: Readonly<{
      operator?: "gt" | "gte";
      years?: number;
      ownerArea?: "any" | "out_of_county" | "out_of_state";
    }>;
    freshness?: Readonly<{
      observedAtOrAfter?: string;
      publishedAtOrAfter?: string;
    }>;
    matchMode?: "all" | "any";
  }>;
  readonly sort: "distance_asc" | "roof_age_desc" | "permit_open_days_desc";
  readonly page: Readonly<{ limit: number; cursor?: string }>;
  readonly asOf?: string;
}

export interface RoofingOpportunity {
  readonly property: Property;
  readonly distanceMeters: Fact<number>;
  readonly matchReasons: readonly (
    "roof_age" | "open_roofing_permit" | "ownership_duration" | "owner_area"
  )[];
}

export interface SearchResultData {
  readonly resolvedCenter: Fact<Coordinates>;
  readonly opportunities: readonly RoofingOpportunity[];
}

export interface GetPropertyInput {
  readonly propertyId: PropertyId;
}

export interface GetPermitInput {
  readonly permitId: PermitId;
}

export interface OracleCallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface OracleMcpTransport {
  callTool(
    tool: OracleMcpToolName,
    input: Readonly<Record<string, unknown>>,
    options?: OracleCallOptions,
  ): Promise<unknown>;
  listTools?(options?: OracleCallOptions): Promise<readonly OracleMcpToolDescriptor[]>;
}

export interface OracleMcpToolDescriptor {
  readonly name: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>> | null;
}

export interface OracleClient {
  discoverTools?(
    options?: OracleCallOptions,
  ): Promise<readonly OracleMcpToolDescriptor[]>;
  getServiceInfo(options?: OracleCallOptions): Promise<OracleResult<JsonObject>>;
  getPipelineRunSummary(
    input?: JsonObject,
    options?: OracleCallOptions,
  ): Promise<OracleResult<JsonObject>>;
  searchRoofingOpportunities(
    input: SearchArguments,
    options?: OracleCallOptions,
  ): Promise<OracleResult<SearchResultData>>;
  getProperty(
    input: GetPropertyInput,
    options?: OracleCallOptions,
  ): Promise<OracleResult<Property>>;
  getPermit(
    input: GetPermitInput,
    options?: OracleCallOptions,
  ): Promise<OracleResult<Permit>>;
  getQuerySchema(options?: OracleCallOptions): Promise<OracleResult<JsonObject>>;
}
