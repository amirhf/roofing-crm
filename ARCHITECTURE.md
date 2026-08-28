# Prism Roofing CRM architecture freeze

Status: approved control baseline. This document defines architecture; it is not implementation or evidence that a hosted project or database exists.

## Outcome and boundary

The CRM outcome is a public map-based demo that uses the shared Oracle MCP to identify roofing opportunities and lets an anonymous evaluator persist CRM-owned leads within a seven-day demo session.

The CRM does not own, collect or recalculate Oracle facts. Its only Oracle connection is `ORACLE_MCP_URL`. It never connects to Oracle PostgreSQL, Restate, DuckDB/Parquet files, Filebase, IPFS, source systems or sibling repositories.

## Hosted target

- Existing authenticated personal Vercel account; account ID **PENDING until deployment**.
- Separate Vercel project label: `prism-roofing-crm`.
- No custom domain required.
- Neon project/database target label: `prism-roofing-crm`.
- Vercel project ID, deployment URL and Neon connection string are **PENDING**.

No hosted CRM runtime depends on the local Oracle mutation plane.

## Public evaluator session and CRM state

The CRM has no login or account-creation step. On first visit, the server creates a cryptographically random anonymous session identifier and sends a signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie with mandatory seven-day expiry. Neon stores only a hash of the identifier alongside CRM lead rows.

Lead mutations enforce the signed session and same-origin requests. Leads survive refresh within the same browser session. A second clean session cannot read or mutate the first session’s leads. Cookie expiry is mandatory. Database cleanup may occur opportunistically during normal reads/writes; no cron, queue, Redis or managed cleanup service is introduced solely for retention.

The normative lead shape is `contracts/crm-lead-v1.schema.json`. A lead stores its CRM UUID, deterministic Oracle reference key, Oracle contract/hash, property and optional permit IDs, publication CID, captured time, CRM status and notes. CRM status and notes never write back to Oracle.

## Oracle retrieval and interface

The committed `contracts/mcp-v1.schema.json` is byte-identical to Oracle’s. Active v1-family revision `1.1.0` supersedes the committed `1.0.0` schema with SHA-256 `714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7`; both the active hash and superseded historical evidence are recorded in `contracts/contract-lock.json`. The active hash must match live MCP discovery metadata before integration is claimed.

The public MCP advertises exactly:

- `prism_v1_get_service_info`
- `prism_v1_get_pipeline_run_summary`
- `prism_v1_search_roofing_opportunities`
- `prism_v1_get_property`
- `prism_v1_get_permit`
- `prism_v1_get_query_schema`

The CRM transport may call all six validated tools. Its consuming AI agent uses the least-privilege workflow subset `prism_v1_search_roofing_opportunities`, `prism_v1_get_property`, and `prism_v1_get_permit`; service information, latest-run summary and query capabilities remain deterministic application/controller calls outside the model tool whitelist.

The UI defaults to Pasco, supports browser GPS or pin center, validated miles/kilometres radius, direct/proxy roof-age basis, open/long-open permit filters, stable pagination, map/list browsing, evidence detail and lead conversion.

The MCP is public and read-only. There is no evaluator token. AI and Neon credentials remain server-side.

## AI behavior

Use Vercel AI SDK with server-side provider/gateway configuration. The model translates language into validated structured v1 tool inputs and summarizes returned evidence. Deterministic Oracle/MCP code performs all calculations, matching, filters and sorting. The model never generates SQL.

Freshness is displayed as source metadata. Explicit `observedAtOrAfter` or `publishedAtOrAfter` inputs are sent only when the user requests them.

## Failure behavior

- MCP unavailable: existing CRM leads remain usable; search, detail refresh and agent retrieval return an explicit dependency error.
- AI unavailable: deterministic map/list search and lead management remain usable; agent displays an explicit provider-unavailable state.
- Missing BBB, roof, ownership, contractor or business data: render the MCP’s unavailable reason without substitution.
- Fixture or contract-hash mismatch in production: fail closed; never use fixture data as a replacement.

## Pending external inputs

- Vercel account/project ID and deployment URL: **PENDING**
- Neon connection string: **PENDING**
- Oracle deployed URL for `ORACLE_MCP_URL`: **PENDING**
- Oracle source commit in `contracts/contract-lock.json`: **PENDING until baseline commit exists**
- Assignment-sent timestamp: **PENDING**
