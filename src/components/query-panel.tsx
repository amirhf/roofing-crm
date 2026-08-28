"use client";

export function QueryPanel() {
  return (
    <section className="query-workspace" aria-labelledby="query-heading">
      <div className="query-card">
        <p className="eyebrow">Next checkpoint</p>
        <h1 id="query-heading">Ask Roofline</h1>
        <p>
          The request and grounded-result boundary is typed, but no live model is
          connected. Structured search remains the source of truth.
        </p>
        <label>
          Natural-language request
          <textarea
            rows={5}
            disabled
            placeholder="For example: older roofs near Zephyrhills with long-open permits"
          />
        </label>
        <button type="button" className="primary-button" disabled>
          Grounded agent not configured
        </button>
      </div>
    </section>
  );
}
