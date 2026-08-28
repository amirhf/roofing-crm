const futureSections = ["Leads", "Agent", "Territories", "Campaigns", "Reports"];

function RoofMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 42">
      <path d="M5 22.4 21 8l16 14.4v11.1H26.8V23h-11v10.5H5V22.4Z" />
      <path d="m11 20.4 10-8.9 10 8.9" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="Primary navigation">
        <a className="brand" href="#workspace" aria-label="Roofline home">
          <span className="brand-mark">
            <RoofMark />
          </span>
          <span>
            <strong>Roofline</strong>
            <small>by Prism</small>
          </span>
        </a>

        <nav className="navigation">
          <p className="eyebrow">Workspace</p>
          <a className="nav-item active" href="#workspace" aria-current="page">
            <span className="nav-number">01</span>
            Explore
          </a>
          {futureSections.map((section, index) => (
            <button
              className="nav-item"
              type="button"
              disabled
              title={`${section} is planned for a future release`}
              key={section}
            >
              <span className="nav-number">0{index + 2}</span>
              {section}
              <span className="soon">Soon</span>
            </button>
          ))}
        </nav>

        <div className="rail-note">
          <span className="status-dot" />
          <p>
            Foundation mode
            <small>Oracle connection is server-managed</small>
          </p>
        </div>
      </aside>

      <section className="main-panel" id="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Pasco County, Florida</p>
            <h1>Find the roofs that need attention.</h1>
          </div>
          <div className="county-chip">
            <PinIcon />
            <span>
              Default territory
              <strong>Pasco County</strong>
            </span>
          </div>
        </header>

        <div className="workspace-grid">
          <section className="search-panel" aria-labelledby="search-heading">
            <div className="section-heading">
              <p className="eyebrow">Opportunity search</p>
              <h2 id="search-heading">Start with a place</h2>
              <p>Search controls are staged for the map milestone.</p>
            </div>

            <div className="field-preview">
              <span>Center</span>
              <strong>Pasco County</strong>
              <small>GPS or dropped pin</small>
            </div>
            <div className="filter-row">
              <div>
                <span>Radius</span>
                <strong>5 mi</strong>
              </div>
              <div>
                <span>Roof age</span>
                <strong>&gt; 15 years</strong>
              </div>
            </div>
            <div className="signal-preview">
              <span className="check-mark">✓</span>
              <p>
                Open roofing permits
                <small>Prioritize longest-open first</small>
              </p>
            </div>
            <button className="primary-action" type="button" disabled>
              Search becomes available with map integration
            </button>
            <p className="boundary-copy">
              Property facts will arrive only through the configured Oracle MCP boundary.
            </p>
          </section>

          <section className="map-stage" aria-label="Map workspace placeholder">
            <div className="map-label north">PASCO</div>
            <div className="map-label east">ZEPHYRHILLS</div>
            <div className="map-label west">NEW PORT RICHEY</div>
            <div className="radius-ring outer" />
            <div className="radius-ring inner" />
            <div className="map-pin">
              <PinIcon />
            </div>
            <div className="map-message">
              <span>Map foundation</span>
              <h2>Your territory, ready for signals.</h2>
              <p>
                Live geography, results, and selection sync are intentionally reserved for
                the next checkpoint.
              </p>
            </div>
            <div className="map-scale">
              <span />5 miles
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
