"use client";

import { forwardRef } from "react";

import type { Fact, Permit, Property, RoofingOpportunity } from "@/oracle/types";

const reasonLabels = {
  not_provided_by_source: "Not provided by the source",
  source_not_collected: "Source not collected",
  source_unavailable: "Source unavailable",
  not_applicable: "Not applicable",
  ambiguous_match: "Match is ambiguous",
} as const;

function unavailable(fact: Fact<unknown>): string {
  return fact.availability === "unavailable" ? reasonLabels[fact.reason] : "Unavailable";
}

function PermitCard({ permit }: Readonly<{ permit: Permit }>) {
  return (
    <article className="permit-card">
      <div>
        <p className="detail-label">Permit</p>
        <strong>
          {permit.permitNumber.availability === "available"
            ? permit.permitNumber.value
            : unavailable(permit.permitNumber)}
        </strong>
      </div>
      <dl className="detail-grid compact">
        <div>
          <dt>Status</dt>
          <dd>
            {permit.status.availability === "available"
              ? permit.status.value
              : unavailable(permit.status)}
          </dd>
        </div>
        <div>
          <dt>Open duration</dt>
          <dd>
            {permit.openDurationDays.availability === "available"
              ? `${permit.openDurationDays.value} days`
              : unavailable(permit.openDurationDays)}
          </dd>
        </div>
        <div>
          <dt>Contractor</dt>
          <dd>
            {permit.contractor.availability === "available"
              ? permit.contractor.value.name
              : unavailable(permit.contractor)}
          </dd>
        </div>
        <div>
          <dt>BBB</dt>
          <dd>
            {permit.bbbRating.availability === "available"
              ? permit.bbbRating.value
              : unavailable(permit.bbbRating)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function PropertyEvidence({ property }: Readonly<{ property: Property }>) {
  const evidence = [
    ...property.evidence,
    ...property.permits.flatMap((permit) => permit.evidence),
  ];
  return (
    <div className="evidence-list">
      {evidence.map((item) => (
        <article key={item.evidenceId} className="evidence-card">
          <span className="evidence-index">SRC</span>
          <div>
            <strong>{item.sourceName}</strong>
            <p>{item.sourceRecordKey}</p>
            <small>
              Observed{" "}
              {item.observedAt
                ? new Date(item.observedAt).toLocaleDateString()
                : "unknown"}
            </small>
            {item.sourceUrl ? (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Open source evidence
              </a>
            ) : (
              <span className="unavailable-copy">No public evidence link available</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

interface PropertyDetailsProps {
  readonly opportunity: RoofingOpportunity | null;
  readonly leadPending: boolean;
  readonly leadMessage: string | null;
  readonly onCreateLead: () => void;
}

export const PropertyDetails = forwardRef<HTMLElement, PropertyDetailsProps>(
  function PropertyDetails({ opportunity, leadPending, leadMessage, onCreateLead }, ref) {
    if (!opportunity) {
      return (
        <section className="details-panel empty-panel" aria-label="Property details">
          <span className="empty-glyph">⌖</span>
          <h2>Select a result</h2>
          <p>Property signals, permit facts, and source evidence will appear here.</p>
        </section>
      );
    }

    const { property } = opportunity;
    const partial = [
      property.roofAgeSignal,
      property.maximumOpenRoofingPermitDays,
      property.openRoofingPermitCount,
    ].some((fact) => fact.availability === "unavailable");

    return (
      <section
        className="details-panel"
        aria-labelledby="property-detail-heading"
        tabIndex={-1}
        ref={ref}
      >
        <header className="detail-header">
          <div>
            <p className="eyebrow">Property detail</p>
            <h2 id="property-detail-heading">
              {property.address.availability === "available"
                ? property.address.value
                : "Address unavailable"}
            </h2>
            <p className="mono-id">{property.propertyId}</p>
          </div>
          {partial ? <span className="data-badge partial">Partial data</span> : null}
        </header>

        <dl className="detail-grid">
          <div>
            <dt>Parcel / folio</dt>
            <dd>
              {property.folio.availability === "available"
                ? property.folio.value
                : unavailable(property.folio)}
            </dd>
          </div>
          <div>
            <dt>Roof signal</dt>
            <dd>
              {property.roofAgeSignal.availability === "available"
                ? `${property.roofAgeSignal.value.ageYears} years`
                : unavailable(property.roofAgeSignal)}
            </dd>
          </div>
          <div>
            <dt>Signal basis</dt>
            <dd>
              {property.roofAgeSignal.availability === "available"
                ? `${property.roofAgeSignal.value.basis.replaceAll("_", " ")} · ${property.roofAgeSignal.value.basisQuality}`
                : unavailable(property.roofAgeSignal)}
            </dd>
          </div>
          <div>
            <dt>Open roofing permits</dt>
            <dd>
              {property.openRoofingPermitCount.availability === "available"
                ? property.openRoofingPermitCount.value
                : unavailable(property.openRoofingPermitCount)}
            </dd>
          </div>
          <div>
            <dt>Longest open</dt>
            <dd>
              {property.maximumOpenRoofingPermitDays.availability === "available"
                ? `${property.maximumOpenRoofingPermitDays.value} days`
                : unavailable(property.maximumOpenRoofingPermitDays)}
            </dd>
          </div>
          <div>
            <dt>Match signal</dt>
            <dd>{opportunity.matchReasons.join(", ").replaceAll("_", " ")}</dd>
          </div>
        </dl>

        <div className="detail-section">
          <h3>Permits & contractor signals</h3>
          {property.permits.length ? (
            property.permits.map((permit) => (
              <PermitCard key={permit.permitId} permit={permit} />
            ))
          ) : (
            <p className="unavailable-block">
              Permit, contractor, and BBB values are unavailable because this property has
              no returned permit records.
            </p>
          )}
        </div>

        <div className="detail-section" id="provenance">
          <h3>Source provenance</h3>
          <PropertyEvidence property={property} />
        </div>

        <div className="detail-actions">
          <button
            type="button"
            className="primary-button"
            onClick={onCreateLead}
            disabled={leadPending}
          >
            {leadPending ? "Creating lead…" : "Create lead"}
          </button>
          <span aria-live="polite">{leadMessage}</span>
        </div>
      </section>
    );
  },
);
