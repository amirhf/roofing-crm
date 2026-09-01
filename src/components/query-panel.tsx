"use client";

import { useRef, useState } from "react";

import { AGENT_BOUNDS } from "@/agent/schemas";
import type {
  GroundedQueryPermit,
  GroundedQueryProperty,
  GroundedNaturalLanguageResult,
  NaturalLanguageQueryRequest,
  NaturalLanguageQueryResult,
  QuerySuccessMetadata,
} from "@/agent/types";
import type { Fact } from "@/oracle/types";

type QueryState = "idle" | "loading" | "complete" | "not_configured" | "error";

const errorHeadings: Record<
  Extract<NaturalLanguageQueryResult, { status: "error" }>["error"]["code"],
  string
> = {
  invalid_request: "Check the request",
  busy: "Query already running",
  invalid_tool_arguments: "Model tool input rejected",
  invalid_mcp_response: "Invalid Oracle response",
  mcp_error: "Oracle MCP unavailable",
  grounding_rejected: "Unsupported claim rejected",
  tool_limit: "Agent limit reached",
  timeout: "Query timed out",
  ai_budget_unavailable: "AI budget unavailable",
  ai_rate_limited: "AI rate limited",
  ai_temporarily_unavailable: "AI temporarily unavailable",
  ai_authentication_failed: "AI authentication failed",
  ai_configuration_error: "AI configuration error",
  ai_model_unavailable: "AI model unavailable",
  model_error: "Model unavailable",
};

function factText<T>(fact: Fact<T>, format: (value: T) => string): string {
  return fact.availability === "available"
    ? format(fact.value)
    : fact.reason.replaceAll("_", " ");
}

function metricText<T>(
  metric: Readonly<{ value: T | null; unavailableReason: string | null }>,
  format: (value: T) => string = String,
): string {
  return metric.value === null
    ? (metric.unavailableReason ?? "unavailable")
    : format(metric.value as T);
}

function PermitSummary({ permit }: Readonly<{ permit: GroundedQueryPermit }>) {
  return (
    <li className="agent-permit-row">
      <strong>Validated permit record</strong>
      <span>{factText(permit.openDurationDays, (days) => `${days} days open`)}</span>
      <span>{factText(permit.contractor, () => "Contractor value available")}</span>
      <span>BBB {factText(permit.bbbRating, String)}</span>
    </li>
  );
}

function AgentPropertyCard({
  property,
  ordinal,
}: Readonly<{ property: GroundedQueryProperty; ordinal: number }>) {
  const headingId = `agent-property-${ordinal}`;
  return (
    <article className="agent-property-card" aria-labelledby={headingId}>
      <header>
        <p className="eyebrow">Validated MCP record</p>
        <h3 id={headingId}>Grounded property {ordinal}</h3>
        <p className="mono-id">Request-scoped reference</p>
      </header>
      <dl className="agent-fact-grid">
        <div>
          <dt>Roof signal</dt>
          <dd>
            {factText(
              property.roofAgeSignal,
              (signal) =>
                `${signal.ageYears} years · ${signal.basis.replaceAll("_", " ")}`,
            )}
          </dd>
        </div>
        <div>
          <dt>Open roofing permits</dt>
          <dd>{factText(property.openRoofingPermitCount, String)}</dd>
        </div>
        <div>
          <dt>Longest open duration</dt>
          <dd>
            {factText(property.maximumOpenRoofingPermitDays, (days) => `${days} days`)}
          </dd>
        </div>
      </dl>
      {property.permits.length ? (
        <ul className="agent-permit-list" aria-label="Returned permit facts">
          {property.permits.map((permit) => (
            <PermitSummary permit={permit} key={permit.permitRef} />
          ))}
        </ul>
      ) : (
        <p className="agent-unavailable">
          No permit record was returned; contractor and BBB values are unavailable.
        </p>
      )}
    </article>
  );
}

function GroundedResult({
  result,
  metadata,
}: Readonly<{
  result: GroundedNaturalLanguageResult;
  metadata: QuerySuccessMetadata | null;
}>) {
  return (
    <div className="agent-result">
      <header className="agent-answer">
        <p className="eyebrow">
          {result.status === "grounded" ? "Grounding proven" : "Unable to ground"}
        </p>
        <h2>{result.answer}</h2>
        {result.status === "grounded" ? (
          <p className="agent-publication-note">
            Candidate publication only. Results are not authoritative-complete Pasco
            coverage.
          </p>
        ) : null}
        {result.failure ? (
          <p className="agent-failure">
            <strong>{result.failure.code.replaceAll("_", " ")}:</strong>{" "}
            {result.failure.message}
          </p>
        ) : null}
      </header>

      <details className="agent-filter-proof">
        <summary>Exact MCP search input</summary>
        {result.filters ? (
          <pre>{JSON.stringify(result.filters, null, 2)}</pre>
        ) : (
          <p>No roofing-opportunity search was executed.</p>
        )}
      </details>

      {result.properties.length ? (
        <section className="agent-records" aria-labelledby="agent-records-heading">
          <div className="agent-section-heading">
            <h2 id="agent-records-heading">Retrieved properties</h2>
            <span>{result.properties.length}</span>
          </div>
          {result.properties.map((property, index) => (
            <AgentPropertyCard
              property={property}
              ordinal={index + 1}
              key={property.propertyRef}
            />
          ))}
        </section>
      ) : null}

      <div className="agent-proof-grid">
        <section aria-labelledby="agent-evidence-heading">
          <h2 id="agent-evidence-heading">MCP evidence</h2>
          {result.evidence.length ? (
            <ul className="agent-evidence-list">
              {result.evidence.map((evidence) => (
                <li key={evidence.evidenceRef}>
                  <strong>{evidence.sourceName}</strong>
                  <span>Validated request-scoped evidence</span>
                  <small>Canonical source identifiers stay server-held.</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-unavailable">No evidence reference was returned.</p>
          )}
        </section>
        <section aria-labelledby="agent-missing-heading">
          <h2 id="agent-missing-heading">Missing fields</h2>
          {result.missingFields.length ? (
            <ul className="agent-missing-list">
              {result.missingFields.map((field) => (
                <li
                  key={`${field.propertyRef}-${field.permitRef ?? "property"}-${field.field}`}
                >
                  <strong>{field.field}</strong>
                  <span>{field.reason.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-unavailable">No unavailable field was cited.</p>
          )}
        </section>
      </div>
      {metadata ? (
        <details className="agent-filter-proof">
          <summary>Execution metadata</summary>
          <dl className="agent-fact-grid">
            <div>
              <dt>Requested provider</dt>
              <dd>{metadata.requestedProvider}</dd>
            </div>
            <div>
              <dt>Requested model</dt>
              <dd>{metadata.requestedModel}</dd>
            </div>
            <div>
              <dt>SDK response model</dt>
              <dd>{metricText(metadata.sdkResponseModel)}</dd>
            </div>
            <div>
              <dt>Resolved provider</dt>
              <dd>{metricText(metadata.resolvedProvider)}</dd>
            </div>
            <div>
              <dt>Resolved model</dt>
              <dd>{metricText(metadata.resolvedModel)}</dd>
            </div>
            <div>
              <dt>Model generations</dt>
              <dd>{metadata.modelGenerations}</dd>
            </div>
            <div>
              <dt>SDK attempts / retries</dt>
              <dd>
                {metadata.sdkAttemptCount} / {metadata.sdkRetryCount}
              </dd>
            </div>
            <div>
              <dt>Provider attempts</dt>
              <dd>{metricText<number>(metadata.providerAttemptCount, String)}</dd>
            </div>
            <div>
              <dt>Oracle tool calls</dt>
              <dd>{metadata.oracleToolCallCount}</dd>
            </div>
            <div>
              <dt>Query latency</dt>
              <dd>{metadata.queryLatencyMs} ms</dd>
            </div>
            <div>
              <dt>Model latency</dt>
              <dd>
                {metricText<number>(metadata.modelLatencyMs, (value) => `${value} ms`)}
              </dd>
            </div>
            <div>
              <dt>Oracle latency</dt>
              <dd>{metadata.oracleLatencyMs} ms</dd>
            </div>
            <div>
              <dt>Gateway generation time</dt>
              <dd>
                {metricText<number>(
                  metadata.gatewayGenerationTimeMs,
                  (value) => `${value} ms`,
                )}
              </dd>
            </div>
            <div>
              <dt>Total tokens</dt>
              <dd>{metricText<number>(metadata.totalTokens, String)}</dd>
            </div>
            <div>
              <dt>Cost (USD)</dt>
              <dd>{metricText<number>(metadata.costUsd, (value) => value.toFixed(6))}</dd>
            </div>
            <div>
              <dt>Attribution</dt>
              <dd>Hashed anonymous session · {metadata.attribution.tags.join(" · ")}</dd>
            </div>
          </dl>
        </details>
      ) : null}
    </div>
  );
}

export function QueryPanel({
  searchContext,
  oracleReady = true,
}: Readonly<{
  searchContext: NaturalLanguageQueryRequest["searchContext"];
  oracleReady?: boolean;
}>) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<QueryState>("idle");
  const [result, setResult] = useState<GroundedNaturalLanguageResult | null>(null);
  const [metadata, setMetadata] = useState<QuerySuccessMetadata | null>(null);
  const [message, setMessage] = useState(
    "Every property and evidence reference is checked against validated Oracle results before display.",
  );
  const [errorCode, setErrorCode] = useState<
    Extract<NaturalLanguageQueryResult, { status: "error" }>["error"]["code"] | null
  >(null);
  const controllerRef = useRef<AbortController | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  function focusStatus() {
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || state === "loading" || !oracleReady) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("loading");
    setResult(null);
    setMetadata(null);
    setErrorCode(null);
    setMessage("Translating the request and validating read-only Oracle tool results…");

    const input: NaturalLanguageQueryRequest = {
      query: query.trim(),
      searchContext,
    };
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const payload = (await response.json()) as NaturalLanguageQueryResult;
      if (payload.status === "not_configured") {
        setState("not_configured");
        setMessage(payload.message);
      } else if (payload.status === "error") {
        setState("error");
        setErrorCode(payload.error.code);
        setMessage(
          payload.error.retryAfterSeconds === undefined
            ? payload.error.message
            : `${payload.error.message} Retry after ${payload.error.retryAfterSeconds} seconds.`,
        );
      } else if (payload.status === "complete") {
        setState("complete");
        setResult(payload.grounded);
        setMetadata(payload.metadata);
        setMessage(
          payload.grounded.status === "grounded"
            ? "Grounding checks passed. Facts below come from validated MCP records."
            : "The agent returned an explicit ungrounded result without unsupported claims.",
        );
      } else {
        setState("error");
        setErrorCode("model_error");
        setMessage("The query endpoint returned an unknown response state.");
      }
    } catch (error) {
      setState("error");
      setErrorCode("model_error");
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "The query was cancelled."
          : "The grounded query endpoint could not be reached.",
      );
    } finally {
      controllerRef.current = null;
      focusStatus();
    }
  }

  function onQueryKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="query-workspace" aria-labelledby="query-heading">
      <div className="query-intro">
        <p className="eyebrow">Grounded Oracle query</p>
        <h1 id="query-heading">Ask plainly. Verify precisely.</h1>
        <p>
          Describe the Pasco roofing opportunities you need. Roofline translates the
          request into frozen MCP filters; Oracle alone resolves distance, age, duration,
          and eligibility.
        </p>
        <ol className="agent-boundary-list" aria-label="Grounding process">
          <li>
            <span>01</span>Language becomes validated filters.
          </li>
          <li>
            <span>02</span>Only allowlisted read-only MCP tools run.
          </li>
          <li>
            <span>03</span>Every returned reference is checked.
          </li>
        </ol>
      </div>

      <div className="query-console">
        <form onSubmit={(event) => void submit(event)} aria-busy={state === "loading"}>
          <label htmlFor="roofline-query">Natural-language request</label>
          <textarea
            id="roofline-query"
            rows={6}
            value={query}
            maxLength={AGENT_BOUNDS.maxPromptCharacters}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder="Find properties within 8 miles of the selected center with roofs at least 18 years old and an open roofing permit for 45+ days."
            aria-describedby="query-help query-count"
          />
          <div className="query-meta">
            <span id="query-help">⌘/Ctrl + Enter to run</span>
            <span id="query-count">
              {query.length} / {AGENT_BOUNDS.maxPromptCharacters}
            </span>
          </div>
          <div className="query-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={!query.trim() || state === "loading" || !oracleReady}
            >
              {state === "loading" ? "Grounding request…" : "Run grounded query"}
            </button>
            {state === "loading" ? (
              <button
                type="button"
                className="text-button"
                onClick={() => controllerRef.current?.abort()}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div
          className={`agent-status ${state}`}
          role={state === "error" ? "alert" : "status"}
          aria-live="polite"
          tabIndex={-1}
          ref={statusRef}
        >
          <span className="agent-status-mark" aria-hidden="true" />
          <div>
            <strong>
              {state === "not_configured"
                ? "Model not configured"
                : errorCode
                  ? errorHeadings[errorCode]
                  : state === "loading"
                    ? "Grounding in progress"
                    : state === "complete"
                      ? "Server validation complete"
                      : "Grounded boundary ready"}
            </strong>
            <p>
              {oracleReady
                ? message
                : "Oracle readiness must pass before a grounded Query can run."}
            </p>
          </div>
        </div>
      </div>

      {result ? <GroundedResult result={result} metadata={metadata} /> : null}
    </section>
  );
}
