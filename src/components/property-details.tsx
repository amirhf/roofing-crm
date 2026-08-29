"use client";

import { forwardRef } from "react";

import type {
  Fact,
  Freshness,
  Permit,
  Property,
  RoofingOpportunity,
} from "@/oracle/types";

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

function roofBasis(property: Property): string {
  if (property.roofAgeSignal.availability === "unavailable") {
    return unavailable(property.roofAgeSignal);
  }
  const { basis, basisQuality } = property.roofAgeSignal.value;
  if (basis === "year_built_proxy") {
    return "Year built proxy · proxy (not actual roof age)";
  }
  return `${basis.replaceAll("_", " ")} · ${basisQuality}`;
}

function formatTimestamp(timestamp: string | null): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "Unavailable";
}

function FreshnessDetails({ freshness }: Readonly<{ freshness: Freshness }>) {
  return (
    <dl className="freshness-grid">
      <div>
        <dt>Observed</dt>
        <dd>{formatTimestamp(freshness.observedAt)}</dd>
      </div>
      <div>
        <dt>Retrieved</dt>
        <dd>{formatTimestamp(freshness.retrievedAt)}</dd>
      </div>
      <div>
        <dt>Loaded</dt>
        <dd>{formatTimestamp(freshness.loadedAt)}</dd>
      </div>
      <div>
        <dt>Published</dt>
        <dd>{formatTimestamp(freshness.publishedAt)}</dd>
      </div>
      <div>
        <dt>Computed</dt>
        <dd>{formatTimestamp(freshness.computedAt)}</dd>
      </div>
      <div>
        <dt>Source cadence</dt>
        <dd>
          {freshness.sourceCadence ?? "Unavailable"} ·{" "}
          {freshness.cadenceStatus.replaceAll("_", " ")}
        </dd>
      </div>
    </dl>
  );
}

function EvidenceReferences({ references }: Readonly<{ references: readonly string[] }>) {
  return references.length ? (
    <small className="evidence-references">Evidence: {references.join(", ")}</small>
  ) : (
    <small className="unavailable-copy">No evidence identifier returned</small>
  );
}

function MailingComponent<T>({
  label,
  fact,
  format,
}: Readonly<{
  label: string;
  fact: Fact<T>;
  format: (value: T) => string;
}>) {
  return (
    <li>
      <span>{label}</span>
      <strong>
        {fact.availability === "available" ? format(fact.value) : unavailable(fact)}
      </strong>
      <EvidenceReferences references={fact.evidenceRefs} />
    </li>
  );
}

function MailingAddress({ property }: Readonly<{ property: Property }>) {
  const mailing = property.ownership.publicMailingAddress;
  if (mailing.availability === "unavailable") {
    return (
      <>
        {unavailable(mailing)}
        <EvidenceReferences references={mailing.evidenceRefs} />
      </>
    );
  }
  return (
    <>
      <ul className="mailing-component-list">
        <MailingComponent
          label="Address lines"
          fact={mailing.value.addressLines}
          format={(value) => value.join(", ")}
        />
        <MailingComponent
          label="Locality"
          fact={mailing.value.locality}
          format={(value) => value}
        />
        <MailingComponent
          label="Region"
          fact={mailing.value.region}
          format={(value) => value}
        />
        <MailingComponent
          label="Postal code"
          fact={mailing.value.postalCode}
          format={(value) => value}
        />
        <MailingComponent
          label="Country"
          fact={mailing.value.country}
          format={(value) => value}
        />
      </ul>
      <EvidenceReferences references={mailing.evidenceRefs} />
    </>
  );
}

function OwnershipDetails({ property }: Readonly<{ property: Property }>) {
  const { ownership } = property;
  return (
    <div className="ownership-card">
      <dl className="detail-grid compact">
        <div>
          <dt>Current owner names</dt>
          <dd>
            {ownership.currentOwners.availability === "available" ? (
              <>
                <span className="owner-count">
                  {ownership.currentOwners.value.length === 1
                    ? "1 current owner"
                    : `${ownership.currentOwners.value.length} current owners`}
                </span>
                <ul className="owner-list">
                  {ownership.currentOwners.value.map((owner, index) => (
                    <li key={`${owner.displayName}-${index}`}>
                      {owner.displayName}
                      <EvidenceReferences references={owner.evidenceRefs} />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              unavailable(ownership.currentOwners)
            )}
          </dd>
        </div>
        <div>
          <dt>Ownership classification</dt>
          <dd>
            {ownership.classification.availability === "available"
              ? ownership.classification.value
              : unavailable(ownership.classification)}
            <EvidenceReferences references={ownership.classification.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Public mailing address</dt>
          <dd>
            <MailingAddress property={property} />
          </dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>
            {ownership.phone.availability === "available"
              ? ownership.phone.value
              : unavailable(ownership.phone)}
            <EvidenceReferences references={ownership.phone.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            {ownership.email.availability === "available"
              ? ownership.email.value
              : unavailable(ownership.email)}
            <EvidenceReferences references={ownership.email.evidenceRefs} />
          </dd>
        </div>
      </dl>
      <p className="public-record-notice">
        Official public record · approved for publication · source reported and not
        independently verified. Public mailing address and property situs address are
        separate source fields and may contain the same address.
      </p>
    </div>
  );
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
        <EvidenceReferences references={permit.permitNumber.evidenceRefs} />
      </div>
      <dl className="detail-grid compact">
        <div>
          <dt>Status</dt>
          <dd>
            {permit.status.availability === "available"
              ? permit.status.value
              : unavailable(permit.status)}
            <EvidenceReferences references={permit.status.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Open duration</dt>
          <dd>
            {permit.openDurationDays.availability === "available"
              ? `${permit.openDurationDays.value} days`
              : unavailable(permit.openDurationDays)}
            <EvidenceReferences references={permit.openDurationDays.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Contractor</dt>
          <dd>
            {permit.contractor.availability === "available"
              ? permit.contractor.value.name
              : unavailable(permit.contractor)}
            <EvidenceReferences references={permit.contractor.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>BBB</dt>
          <dd>
            {permit.bbbRating.availability === "available"
              ? permit.bbbRating.value
              : unavailable(permit.bbbRating)}
            <EvidenceReferences references={permit.bbbRating.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Open state</dt>
          <dd>
            {permit.isOpen.availability === "available"
              ? permit.isOpen.value
                ? "Open"
                : "Closed"
              : unavailable(permit.isOpen)}
            <EvidenceReferences references={permit.isOpen.evidenceRefs} />
          </dd>
        </div>
        <div>
          <dt>Roofing relevance</dt>
          <dd>
            {permit.roofingRelevance.availability === "available"
              ? permit.roofingRelevance.value
                ? "Roofing related"
                : "Not roofing related"
              : unavailable(permit.roofingRelevance)}
            <EvidenceReferences references={permit.roofingRelevance.evidenceRefs} />
          </dd>
        </div>
      </dl>
      <FreshnessDetails freshness={permit.freshness} />
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
            <small>Evidence {item.evidenceId}</small>
            <small>Observed {formatTimestamp(item.observedAt)}</small>
            <small>Retrieved {formatTimestamp(item.retrievedAt)}</small>
            <small>Loaded {formatTimestamp(item.loadedAt)}</small>
            <small>Published CID {item.publishedCid ?? "Unavailable"}</small>
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
      property.ownership.currentOwners,
      property.ownership.classification,
      property.ownership.publicMailingAddress,
      property.ownership.phone,
      property.ownership.email,
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
              <EvidenceReferences references={property.folio.evidenceRefs} />
            </dd>
          </div>
          <div>
            <dt>Roof signal</dt>
            <dd>
              {property.roofAgeSignal.availability === "available"
                ? `${property.roofAgeSignal.value.ageYears} years`
                : unavailable(property.roofAgeSignal)}
              <EvidenceReferences references={property.roofAgeSignal.evidenceRefs} />
            </dd>
          </div>
          <div>
            <dt>Signal basis</dt>
            <dd>
              {roofBasis(property)}
              <EvidenceReferences references={property.roofAgeSignal.evidenceRefs} />
            </dd>
          </div>
          <div>
            <dt>Open roofing permits</dt>
            <dd>
              {property.openRoofingPermitCount.availability === "available"
                ? property.openRoofingPermitCount.value
                : unavailable(property.openRoofingPermitCount)}
              <EvidenceReferences
                references={property.openRoofingPermitCount.evidenceRefs}
              />
            </dd>
          </div>
          <div>
            <dt>Longest open</dt>
            <dd>
              {property.maximumOpenRoofingPermitDays.availability === "available"
                ? `${property.maximumOpenRoofingPermitDays.value} days`
                : unavailable(property.maximumOpenRoofingPermitDays)}
              <EvidenceReferences
                references={property.maximumOpenRoofingPermitDays.evidenceRefs}
              />
            </dd>
          </div>
          <div>
            <dt>Match signal</dt>
            <dd>{opportunity.matchReasons.join(", ").replaceAll("_", " ")}</dd>
          </div>
        </dl>

        <div className="detail-section">
          <h3>Public ownership & contact</h3>
          <OwnershipDetails property={property} />
        </div>

        <div className="detail-section">
          <h3>Permits & contractor signals</h3>
          {property.permits.length ? (
            property.permits.map((permit) => (
              <PermitCard key={permit.permitId} permit={permit} />
            ))
          ) : (
            <p className="unavailable-block">
              {property.openRoofingPermitCount.availability === "unavailable"
                ? `Permit coverage is unavailable: ${unavailable(property.openRoofingPermitCount)}. Contractor and BBB coverage remain unavailable.`
                : "Oracle returned zero permit records for this property. Contractor and BBB values are unavailable because no permit record was returned."}
            </p>
          )}
        </div>

        <div className="detail-section" id="provenance">
          <h3>Source provenance</h3>
          <FreshnessDetails freshness={property.freshness} />
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
