# Roofing CRM repository authority

This repository is the sole implementation and PR target for the Prism Roofing CRM. One designated CRM writer owns changes after the architecture freeze. Other workstreams may review or request changes but must not edit this repository concurrently.

## Binding sources

Read `ARCHITECTURE.md`, `ACCEPTANCE.md`, `contracts/contract-lock.json`, and the committed schemas before implementation. Shared MCP contract bytes and their hash are controller-owned. Contract changes require controller approval and synchronized byte-identical updates in both assignment repositories.

Reference repositories and the Oracle assignment repository are read-only to the CRM writer. Never change them and never use a sibling checkout as a build or runtime dependency.

## Oracle access boundary

- All Oracle facts come exclusively from the public structured MCP configured by `ORACLE_MCP_URL`.
- The active MCP revision is `1.2.0`; approved official-public-record owner/contact facts remain evidence-backed, explicitly unavailable when absent, and are never treated as independently verified.
- Never access Oracle PostgreSQL, Restate, `DATA_DIR`, DuckDB/Parquet files, Filebase, IPFS, source portals, local artifacts, or sibling repository paths for Oracle facts.
- Never ingest, scrape, repair, enrich, or republish Oracle facts from this repository.
- The CRM owns only anonymous demo-session state and CRM lead lifecycle state.
- Oracle property/permit IDs and source publication CIDs are references, not CRM-owned facts.

## Model and deterministic behavior

- Use Vercel AI SDK with server-side provider/gateway credentials.
- The public MCP advertises all six validated `prism_v1_*` tools. The CRM agent exposes only its least-privilege search/property/permit subset and summarizes evidence-bearing results; deterministic CRM code may use the remaining metadata/capability tools outside the model workflow.
- Models must not calculate distance, roof age, permit duration, ownership duration, matching, sorting, filtering, or lead eligibility.
- Models must not generate or submit SQL.
- Every factual answer must preserve evidence returned by MCP.

## Public demo session

- The evaluator path is public and has no login.
- Generate a cryptographically random anonymous session identifier on the server.
- Store it in a signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie with mandatory seven-day expiry.
- Store only a hash of the identifier with Neon lead rows.
- Enforce same-origin lead mutations and session isolation.
- Cleanup may be opportunistic. Do not introduce cron, queues, Redis, or another managed service solely for retention cleanup or rate limiting.
- Never log the cookie, session identifier, secrets, or unnecessary owner/contact data.

## Fixtures, failure and evidence

- Production rejects fixture sources, known fixture IDs and `fixture://` URIs.
- Never silently fall back to fixtures or bundled Oracle facts.
- If MCP is unavailable, existing leads remain usable while Oracle search/detail/agent retrieval fail explicitly.
- If the AI provider is unavailable, deterministic search and lead management remain usable.
- Never mark an acceptance item proven without observable evidence recorded by the controller.
- Do not edit acceptance outcomes or evaluator evidence status during implementation.
- Do not commit credentials, local absolute paths, generated data or deployment secrets.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
