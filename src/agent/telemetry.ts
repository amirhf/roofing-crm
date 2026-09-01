import "server-only";

import type {
  AgentExecutionTelemetry,
  ObservableTelemetryValue,
  TelemetryUnavailableReason,
} from "./types";

interface StepTelemetrySource {
  readonly model: Readonly<{ provider: string; modelId: string }>;
  readonly response: Readonly<{ modelId: string }>;
  readonly providerMetadata?: Readonly<Record<string, unknown>> | undefined;
  readonly performance: Readonly<{ responseTimeMs: number }>;
  readonly finishReason: string;
}

interface ResultTelemetrySource {
  readonly steps: readonly StepTelemetrySource[];
  readonly usage: Readonly<{
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    totalTokens: number | undefined;
  }>;
  readonly finalStep: StepTelemetrySource;
}

function observed<T>(value: T): ObservableTelemetryValue<T> {
  return { value, unavailableReason: null };
}

function unavailable<T>(
  unavailableReason: TelemetryUnavailableReason,
): ObservableTelemetryValue<T> {
  return { value: null, unavailableReason };
}

function finiteMetric(value: number | undefined): ObservableTelemetryValue<number> {
  return typeof value === "number" && Number.isFinite(value)
    ? observed(value)
    : unavailable("not_reported");
}

function oneReportedValue(values: readonly string[]): ObservableTelemetryValue<string> {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length === 1 && unique[0]
    ? observed(unique[0])
    : unavailable(unique.length > 1 ? "inconsistent" : "not_reported");
}

export async function buildAgentExecutionTelemetry({
  result,
  requestedProvider,
  requestedModel,
  oracleToolCallCount,
  oracleLatencyMs,
}: Readonly<{
  result: ResultTelemetrySource;
  requestedProvider: "gateway" | "mock";
  requestedModel: string;
  oracleToolCallCount: number;
  oracleLatencyMs: number;
}>): Promise<AgentExecutionTelemetry> {
  return {
    requestedProvider,
    requestedModel,
    sdkResponseModel: oneReportedValue(result.steps.map((step) => step.response.modelId)),
    resolvedProvider: unavailable("bounded_lookup_unsupported"),
    resolvedModel: unavailable("bounded_lookup_unsupported"),
    modelGenerations: result.steps.length,
    sdkAttemptCount: result.steps.length,
    sdkRetryCount: 0,
    providerAttemptCount: unavailable("not_observable"),
    oracleToolCallCount,
    modelLatencyMs: finiteMetric(
      result.steps.reduce((total, step) => total + step.performance.responseTimeMs, 0),
    ),
    oracleLatencyMs: Math.max(0, Math.round(oracleLatencyMs)),
    gatewayGenerationTimeMs: unavailable("bounded_lookup_unsupported"),
    inputTokens: finiteMetric(result.usage.inputTokens),
    outputTokens: finiteMetric(result.usage.outputTokens),
    totalTokens: finiteMetric(result.usage.totalTokens),
    costUsd: unavailable("bounded_lookup_unsupported"),
    finishReason: result.finalStep.finishReason
      ? observed(result.finalStep.finishReason)
      : unavailable("not_reported"),
  };
}
