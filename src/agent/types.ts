import type { Fact } from "@/oracle/types";

import type {
  AgentFailureCode,
  AgentModelOutput,
  AgentModelSearchArguments,
  ModelMissingField,
  NaturalLanguageQueryRequest,
} from "./schemas";
import type {
  EvidenceReference,
  PermitReference,
  PropertyReference,
} from "./request-references";

export type {
  AgentFailureCode,
  AgentModelOutput,
  ModelMissingField,
  NaturalLanguageQueryRequest,
};

export type TelemetryUnavailableReason =
  | "not_reported"
  | "not_observable"
  | "generation_id_unavailable"
  | "generation_lookup_unavailable"
  | "bounded_lookup_unsupported"
  | "inconsistent"
  | "not_applicable";

export interface ObservableTelemetryValue<T> {
  readonly value: T | null;
  readonly unavailableReason: TelemetryUnavailableReason | null;
}

export interface AgentExecutionTelemetry {
  readonly requestedProvider: "gateway" | "mock";
  readonly requestedModel: string;
  readonly sdkResponseModel: ObservableTelemetryValue<string>;
  readonly resolvedProvider: ObservableTelemetryValue<string>;
  readonly resolvedModel: ObservableTelemetryValue<string>;
  readonly modelGenerations: number;
  readonly sdkAttemptCount: number;
  readonly sdkRetryCount: 0;
  readonly providerAttemptCount: ObservableTelemetryValue<number>;
  readonly oracleToolCallCount: number;
  readonly modelLatencyMs: ObservableTelemetryValue<number>;
  readonly oracleLatencyMs: number;
  readonly gatewayGenerationTimeMs: ObservableTelemetryValue<number>;
  readonly inputTokens: ObservableTelemetryValue<number>;
  readonly outputTokens: ObservableTelemetryValue<number>;
  readonly totalTokens: ObservableTelemetryValue<number>;
  readonly costUsd: ObservableTelemetryValue<number>;
  readonly finishReason: ObservableTelemetryValue<string>;
}

export interface QuerySuccessMetadata extends AgentExecutionTelemetry {
  readonly requestId: string;
  readonly queryLatencyMs: number;
  readonly completion: "grounded" | "cannot_ground";
  readonly attribution: Readonly<{
    kind: "hashed_anonymous_session";
    tags: readonly string[];
  }>;
}

export interface GroundedQueryPermit {
  readonly permitRef: PermitReference;
  readonly propertyRef: PropertyReference;
  readonly status: Fact<string>;
  readonly isOpen: Fact<boolean>;
  readonly openDurationDays: Fact<number>;
  readonly roofingRelevance: Fact<boolean>;
  readonly contractor: Fact<"available">;
  readonly bbbRating: Fact<string>;
  readonly evidenceRefs: readonly EvidenceReference[];
}

export interface GroundedQueryProperty {
  readonly propertyRef: PropertyReference;
  readonly county: "pasco";
  readonly yearBuilt: Fact<number>;
  readonly roofInstallationDate: Fact<string>;
  readonly roofAgeSignal: Fact<{
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
  }>;
  readonly ownershipDurationYears: Fact<number>;
  readonly openRoofingPermitCount: Fact<number>;
  readonly maximumOpenRoofingPermitDays: Fact<number>;
  readonly permits: readonly GroundedQueryPermit[];
  readonly evidenceRefs: readonly EvidenceReference[];
}

export interface GroundedQueryEvidence {
  readonly evidenceRef: EvidenceReference;
  readonly sourceName: string;
  readonly observedAt: string | null;
  readonly retrievedAt: string;
  readonly loadedAt: string;
}

export interface GroundedNaturalLanguageResult {
  readonly status: "grounded" | "cannot_ground";
  readonly answer: string;
  readonly failure: Readonly<{
    code: AgentFailureCode;
    message: string;
  }> | null;
  readonly filters: AgentModelSearchArguments | null;
  readonly propertyRefs: readonly PropertyReference[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly missingFields: readonly ModelMissingField[];
  readonly properties: readonly GroundedQueryProperty[];
  readonly evidence: readonly GroundedQueryEvidence[];
}

export type NaturalLanguageQueryResult =
  | Readonly<{
      status: "not_configured";
      message: string;
    }>
  | Readonly<{
      status: "complete";
      grounded: GroundedNaturalLanguageResult;
      metadata: QuerySuccessMetadata;
    }>
  | Readonly<{
      status: "error";
      error: Readonly<{
        code:
          | "invalid_request"
          | "busy"
          | "invalid_tool_arguments"
          | "invalid_mcp_response"
          | "mcp_error"
          | "grounding_rejected"
          | "tool_limit"
          | "timeout"
          | "ai_budget_unavailable"
          | "ai_rate_limited"
          | "ai_temporarily_unavailable"
          | "ai_authentication_failed"
          | "ai_configuration_error"
          | "ai_model_unavailable"
          | "model_error";
        message: string;
        requestId?: string;
        retryAfterSeconds?: number;
      }>;
    }>;

export function missingFieldKey(field: {
  readonly propertyId: string;
  readonly permitId: string | null;
  readonly field: string;
  readonly reason: string;
}): string {
  return [field.propertyId, field.permitId ?? "", field.field, field.reason].join("|");
}
