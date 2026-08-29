# Roofing CRM evaluator evidence plan

This file defines required evidence locations. It contains no completed evidence and does not mark acceptance criteria proven.

## Approved hosted target labels

- Vercel account: existing authenticated personal account; account ID **PENDING until deployment**.
- Vercel project label: `prism-roofing-crm`; project ID and URL **PENDING until deployment**.
- Neon project/database target label: `prism-roofing-crm`; connection string **PENDING**.
- Custom domain: not required.

## Evidence index

| Evidence | Location |
|---|---|
| Git commit and PR | ______________________________ |
| Shared contract byte/hash comparison | ______________________________ |
| Fresh-clone build | ______________________________ |
| Public deployment URL | ______________________________ |
| No-login landing page | ______________________________ |
| GPS/pin and radius behavior | ______________________________ |
| Roof-age/open-permit filters | ______________________________ |
| Property/permit evidence detail | ______________________________ |
| Anonymous cookie attributes/expiry | ______________________________ |
| Same-session refresh persistence | ______________________________ |
| Cross-session lead isolation | ______________________________ |
| Neon CRM-owned lead rows | ______________________________ |
| Agent structured-tool trace | ______________________________ |
| No model calculation/SQL proof | ______________________________ |
| MCP dependency failure behavior | ______________________________ |
| AI dependency failure behavior | ______________________________ |
| Fixture exclusion scan | ______________________________ |
| Secret/session/PII log scan | ______________________________ |
| Clean-browser recording | ______________________________ |
| No-localhost verification | ______________________________ |

## Clean-browser procedure

1. Use a fresh browser profile with no existing cookie, local files or localhost dependency.
2. Open the public CRM without a login or evaluator secret.
3. Confirm Pasco default, choose GPS or drop a pin, and set a radius.
4. Filter roof signals older than 15 years and inspect the direct/proxy basis.
5. Filter open roofing permits and order by open duration.
6. Open a property/permit and inspect contractor, BBB availability and evidence.
7. Convert a match to a lead, update CRM status/notes, and refresh.
8. Confirm the lead persists in the same anonymous session.
9. Open a second clean session and confirm the first session’s lead is inaccessible.
10. Inspect the seven-day cookie expiry and server-side session validation.
11. Ask the approved roofing questions and record the structured MCP calls.
12. Confirm the trace contains no SQL and no model-produced calculation.
13. Disconnect evaluator-local Oracle services and repeat the hosted search.

## Boundary and failure proof

- Application configuration contains `ORACLE_MCP_URL` but no Oracle database, Filebase, IPFS, DuckDB, Restate or sibling-path access.
- AI and Neon secrets are server-side and absent from browser assets/logs.
- MCP unavailability preserves existing lead access while disabling Oracle-dependent actions explicitly.
- AI unavailability preserves deterministic map/list and lead functions.
- Production rejects fixture records and does not substitute bundled Oracle facts.
- Database cleanup is opportunistic; no retention-only cron, queue or managed service is introduced.

## Pending external inputs

- Vercel account/project ID and URL: **PENDING**
- Neon connection string: **PENDING**
- Deployed `ORACLE_MCP_URL`: **PENDING**
- Oracle contract-source commit: `29da2fd4d7635bf6eefa1cc159600a18cdccea33` (**VERIFIED**)
- Assignment-sent timestamp: **PENDING**
