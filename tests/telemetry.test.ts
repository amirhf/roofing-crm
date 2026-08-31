import { describe, expect, it } from "vitest";

import { buildAgentExecutionTelemetry } from "../src/agent/telemetry";

function step(generationId: string, responseModel: string) {
  return {
    model: { provider: "gateway", modelId: "requested/model" },
    response: { modelId: responseModel },
    providerMetadata: { gateway: { generationId } },
    performance: { responseTimeMs: 25 },
    finishReason: "stop",
  };
}

describe("grounded query execution telemetry", () => {
  it("reports SDK facts without starting an unbounded Gateway enrichment lookup", async () => {
    const steps = [
      step("generation-1", "gateway/response"),
      step("generation-2", "gateway/response"),
    ];
    const telemetry = await buildAgentExecutionTelemetry({
      result: {
        steps,
        finalStep: steps[1]!,
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      },
      requestedProvider: "gateway",
      requestedModel: "requested/model",
      oracleToolCallCount: 1,
      oracleLatencyMs: 12.7,
    });

    expect(telemetry).toMatchObject({
      requestedProvider: "gateway",
      requestedModel: "requested/model",
      sdkResponseModel: { value: "gateway/response", unavailableReason: null },
      resolvedProvider: {
        value: null,
        unavailableReason: "bounded_lookup_unsupported",
      },
      resolvedModel: {
        value: null,
        unavailableReason: "bounded_lookup_unsupported",
      },
      modelGenerations: 2,
      sdkAttemptCount: 2,
      sdkRetryCount: 0,
      providerAttemptCount: { value: null, unavailableReason: "not_observable" },
      oracleToolCallCount: 1,
      modelLatencyMs: { value: 50, unavailableReason: null },
      oracleLatencyMs: 13,
      gatewayGenerationTimeMs: {
        value: null,
        unavailableReason: "bounded_lookup_unsupported",
      },
      inputTokens: { value: 20, unavailableReason: null },
      outputTokens: { value: 10, unavailableReason: null },
      totalTokens: { value: 30, unavailableReason: null },
      costUsd: { value: null, unavailableReason: "bounded_lookup_unsupported" },
      finishReason: { value: "stop", unavailableReason: null },
    });
  });

  it("marks Gateway-only fields unavailable instead of guessing", async () => {
    const withoutGenerationId = {
      ...step("unused", "response/model"),
      providerMetadata: {},
    };
    const telemetry = await buildAgentExecutionTelemetry({
      result: {
        steps: [withoutGenerationId],
        finalStep: withoutGenerationId,
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        },
      },
      requestedProvider: "mock",
      requestedModel: "mock/model",
      oracleToolCallCount: 0,
      oracleLatencyMs: 0,
    });

    expect(telemetry.resolvedProvider).toEqual({
      value: null,
      unavailableReason: "bounded_lookup_unsupported",
    });
    expect(telemetry.costUsd).toEqual({
      value: null,
      unavailableReason: "bounded_lookup_unsupported",
    });
    expect(telemetry.totalTokens).toEqual({
      value: null,
      unavailableReason: "not_reported",
    });
  });
});
