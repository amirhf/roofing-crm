import type { Evidence, Property, SearchArguments } from "@/oracle/types";

import type {
  AgentFailureCode,
  AgentModelOutput,
  MissingField,
  NaturalLanguageQueryRequest,
} from "./schemas";

export type {
  AgentFailureCode,
  AgentModelOutput,
  MissingField,
  NaturalLanguageQueryRequest,
};

export interface GroundedNaturalLanguageResult extends Omit<AgentModelOutput, "failure"> {
  readonly status: "grounded" | "cannot_ground";
  readonly answer: string;
  readonly failure: Readonly<{
    code: AgentFailureCode;
    message: string;
  }> | null;
  readonly filters: SearchArguments | null;
  readonly properties: readonly Property[];
  readonly evidence: readonly Evidence[];
}

export type NaturalLanguageQueryResult =
  | Readonly<{
      status: "not_configured";
      message: string;
    }>
  | Readonly<{
      status: "complete";
      grounded: GroundedNaturalLanguageResult;
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

export function missingFieldKey(field: MissingField): string {
  return [field.propertyId, field.permitId ?? "", field.field, field.reason].join("|");
}
