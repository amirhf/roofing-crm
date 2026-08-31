export interface PublicationReadiness {
  readonly ready: true;
  readonly contractVersion: "1.2.0";
  readonly publication: Readonly<{
    label: string;
    recordCount: number;
    authoritativeComplete: false;
    publicationStatus: string;
    datasetFreshness: string;
    coordinatesAvailable: number;
    coordinatesUnavailable: number;
    roofSignalsDirect: number;
    roofSignalsProxy: number;
    permits: "available" | "partial" | "unavailable";
    contractors: "available" | "partial" | "unavailable";
  }>;
}

export type PublicationState =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "ready"; readiness: PublicationReadiness }>;

function coverageLabel(value: "available" | "partial" | "unavailable"): string {
  return value === "partial" ? "partial" : value;
}

export function PublicationDisclosure({
  state,
  onRetry,
}: Readonly<{ state: PublicationState; onRetry?: () => void }>) {
  if (state.status === "checking") {
    return (
      <aside className="publication-disclosure" role="status" aria-live="polite">
        <strong>Validating Oracle publication readiness…</strong>
        <span>
          Search and Query remain disabled until the frozen MCP boundary passes.
        </span>
      </aside>
    );
  }
  if (state.status === "unavailable") {
    return (
      <aside className="publication-disclosure unavailable" role="alert">
        <strong>Oracle publication is unavailable.</strong>
        <span>No fixture data or stale readiness state will replace it.</span>
        {onRetry ? (
          <button type="button" className="publication-retry" onClick={onRetry}>
            Check Oracle readiness again
          </button>
        ) : null}
      </aside>
    );
  }

  const { publication } = state.readiness;
  return (
    <aside className="publication-disclosure" aria-label="Oracle publication limits">
      <strong>{publication.label}</strong>
      <span>
        {publication.recordCount.toLocaleString()} records · not authoritative-complete
        Pasco coverage
      </span>
      <span>
        Roof signal basis: {publication.roofSignalsProxy.toLocaleString()} proxy /{` `}
        {publication.roofSignalsDirect.toLocaleString()} direct
      </span>
      <span>
        Permits {coverageLabel(publication.permits)} · contractors{" "}
        {coverageLabel(publication.contractors)}
      </span>
      <span>
        Validated MCP {state.readiness.contractVersion} · freshness{" "}
        {new Date(publication.datasetFreshness).toLocaleDateString()}
      </span>
    </aside>
  );
}
