# CRM builder prompt

This prompt is an implementation handoff for a later authorized phase. It does not authorize work now.

```text
You are the sole writer for the Roofing CRM assignment repository.

Read and obey AGENTS.md, ARCHITECTURE.md, ACCEPTANCE.md, the contract lock and
schemas. Treat all architecture-control documents and shared contracts as
read-only. Do not change contract bytes, hashes, acceptance outcomes or
evaluator evidence status. Report a conflict to the controller. Never modify
the Oracle or reference repositories or inspect another candidate's work.

Implement a public Pasco-default roofing lead CRM in this repository. Obtain
all Oracle facts exclusively through ORACLE_MCP_URL and active MCP contract
revision 1.1.0. The server advertises all six frozen prism_v1_* tools; expose
only prism_v1_search_roofing_opportunities, prism_v1_get_property and
prism_v1_get_permit to the AI agent as its least-privilege workflow subset.
Use service information, pipeline summary and query capabilities only through
deterministic application/controller paths. Do not connect to Oracle PostgreSQL, Restate, DATA_DIR,
DuckDB/Parquet files, Filebase, IPFS, source portals, local artifacts or sibling
paths. Do not ingest or recalculate Oracle facts.

Deploy later to the approved prism-roofing-crm Vercel project label and use the
approved prism-roofing-crm Neon target only when deployment is explicitly
authorized. No custom domain or evaluator login is required.

Create a cryptographically random anonymous session identifier server-side,
sign it with DEMO_SESSION_SECRET, and send it as an HttpOnly, Secure,
SameSite=Lax cookie with mandatory seven-day expiry. Store only a hash of the
identifier with CRM lead rows. Enforce same-origin lead mutations, persistence
across refresh and isolation between clean sessions. Cleanup may be
opportunistic; do not add cron, a queue, Redis or another managed service solely
for retention or rate limiting.

Implement GPS and pin centers, validated radius, explicit roof threshold/basis,
open/long-open permit filters, stable pagination, synchronized map/list,
property/permit evidence detail and CRM-owned lead lifecycle. Preserve Oracle
IDs, contract/schema hash, publication CID and capture timestamp on each lead.
Never write CRM status or notes to Oracle.

Use Vercel AI SDK with server-side credentials. The model may translate natural
language into validated structured calls and summarize evidence. It must not
calculate distance, age, duration, matching, filtering, sorting or eligibility,
and must not generate SQL.

MCP failure leaves existing leads usable while search/detail/agent retrieval
fails explicitly. AI failure leaves deterministic search and lead management
usable. Missing Oracle data stays explicitly unavailable. Production rejects
fixture sources, known fixture IDs and fixture:// evidence and never falls back
to fixtures.

Run implementation tests and collect raw verification outputs in a separate
work area for controller review. Do not edit ACCEPTANCE.md outcomes or
docs/evaluator-evidence.md evidence locations. Do not commit, deploy or open a
PR unless later implementation authorization explicitly includes it.
```
