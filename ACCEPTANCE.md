# Roofing CRM operational acceptance checklist

Documentation state: no criterion has been evaluated or marked proven.

For every row, record one outcome only after implementation and independent observation:

- ☐ Proven — complete observable evidence satisfies the target.
- ☐ Partially proven — real evidence exists but behavior is incomplete.
- ☐ Blocked — an identified external dependency prevents proof.
- ☐ Unmet — implementation or evidence does not satisfy the target.

Blank outcome boxes mean not evaluated. “Required” is the acceptance target, not an achieved status.

### C-01 — Public Pasco-default experience

- Target: **Required**
- Requirement: Public CRM opens without login and defaults the map/search to Pasco County.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-02 — GPS and pin center

- Target: **Required**
- Requirement: Browser GPS and/or a map pin can define the validated search center.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-03 — Configurable radius

- Target: **Required**
- Requirement: Miles/kilometres radius control respects the frozen MCP bounds.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-04 — Roof-age opportunities

- Target: **Required**
- Requirement: Results support explicit threshold/operator and direct-only versus direct-or-proxy basis, defaulting to the approved older-than-15 example.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-05 — Open/long-open permits

- Target: **Required**
- Requirement: Results support open-only and minimum-open-duration filters and deterministic sort.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-06 — Property and permit detail

- Target: **Required**
- Requirement: Detail displays status, duration, contractor, BBB availability, source timestamps and evidence without filling missing values.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-07 — Browsable synchronized results

- Target: **Required**
- Requirement: Map/list selection, stable sorting and bounded cursor pagination remain synchronized.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-08 — Anonymous session

- Target: **Required**
- Requirement: Signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie expires after seven days; no login is required.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-09 — Lead persistence and isolation

- Target: **Required**
- Requirement: CRM-owned leads survive refresh in one session and are invisible to a second clean session.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-10 — Lead lifecycle

- Target: **Required**
- Requirement: Lead create/read/update/status/notes persist in Neon without writing Oracle.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-11 — Oracle access boundary

- Target: **Required**
- Requirement: All Oracle facts come exclusively through `ORACLE_MCP_URL`; no direct Oracle storage/source/sibling access exists.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-12 — Natural-language agent

- Target: **Required**
- Requirement: Vercel AI SDK agent uses only validated `prism_v1_*` calls and source-backed answers.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-13 — No model calculations or SQL

- Target: **Required**
- Requirement: Tool traces prove distance, ages, durations, filtering and sorting came from MCP; the model emitted no SQL.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-14 — Dependency failures

- Target: **Required**
- Requirement: Existing leads remain usable during MCP failure; search/agent fail explicitly; AI failure does not disable deterministic CRM features.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-15 — Production fixture exclusion

- Target: **Required**
- Requirement: Production rejects fixture sources, known fixture IDs and `fixture://` evidence and never falls back to fixtures.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-16 — Disabled future sections

- Target: **Time-permitting**
- Requirement: Clearly disabled future sections are visible and do not imply implemented workflows.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

### C-17 — Clean hosted demo

- Target: **Required**
- Requirement: Clean browser proves pin/GPS, radius, filters, detail, lead conversion/persistence and agent without localhost or credentials.
- Outcome: ☐ Proven ☐ Partially proven ☐ Blocked ☐ Unmet
- Evidence: ______________________________

## Pending scoring input

- Assignment-sent timestamp: **PENDING**
- Speed evidence/status: **PENDING — do not infer**
