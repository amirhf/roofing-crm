# Roofing CRM operations runbook

This runbook covers CRM verification and recovery. Oracle publication, Filebase,
IPFS, and IPNS are owned by the Oracle project and must never be mutated from
this repository.

## Required configuration

Configure names and scopes in Vercel without copying values into source control.

| Boundary | Production variables |
| --- | --- |
| Oracle | `ORACLE_DATA_SOURCE`, `ORACLE_MCP_URL`, `ORACLE_MCP_TIMEOUT_MS` |
| Leads | `LEAD_REPOSITORY`, `DATABASE_URL` |
| Sessions | `SESSION_SECRET` |
| AI Gateway | `AI_PROVIDER`, `AI_MODEL`, and either `AI_GATEWAY_API_KEY` or verified Vercel OIDC |

Production uses `mcp` and `postgres`; it rejects fixture Oracle data and memory
lead storage. `AI_MODEL` uses the lowercase `provider/model` form. Never persist
`VERCEL_OIDC_TOKEN`, print connection strings, or enable model-content logging.

## Local verification

Use Node 22 and npm from the committed lockfile:

```bash
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:integration:postgres-migration
npm audit
```

The disposable migration verifier proves mapping, legacy/new-writer
compatibility, replay, rollback, and concurrent identity behavior. It does not
prove deployed Neon persistence. Follow the dedicated lead-contract migration
runbook before any authorized database change.

For an explicitly authorized read-only Oracle endpoint, run:

```bash
ORACLE_MCP_URL=https://example.invalid/mcp npm run test:integration:mcp
ORACLE_MCP_URL=https://example.invalid/mcp npm run test:e2e:real-mcp
```

The ordinary test suite must not depend on a live external service.

## Preview and production verification

1. Confirm the Vercel deployment Git SHA and Ready status before testing its
   immutable URL.
2. Open `/api/oracle/health`. Require `ready: true`, MCP `1.2.0`, the pinned
   schema hash, and the six ordered tools; HTTP 200 alone is insufficient.
3. In a fresh anonymous browser, verify Explore search, map/list/detail
   synchronization, proxy wording, evidence, and unavailable permit/contractor
   coverage.
4. Verify Query uses the current Explore center and radius while model traffic
   contains only request-scoped references and the privacy-safe canonical
   context. Confirm `maxRetries: 0` and sanitized success telemetry.
5. Verify lead isolation. Run Neon writes only in a separately authorized
   persistence checkpoint with synthetic data.
6. Inspect sanitized function logs by request ID. Logs must not contain prompts,
   coordinates, cursors, records, identifiers, PII, response bodies, or secrets.
7. Promote through the existing Vercel Git deployment topology. GitHub Actions
   verifies the repository and does not deploy it.

## Rollback

Use the Vercel project deployment history to promote the previous known-good
Ready deployment. Confirm its immutable URL, Git SHA, and production alias,
then repeat health, Explore, Query-boundary, and lead-read checks. A rollback
does not authorize reverting contracts, mutating Oracle publication, or rolling
back Neon data.

## Failure triage

- **Oracle unavailable:** correlate the sanitized request ID and readiness
  stage; distinguish timeout, HTTP 502/503/504, transport, response-size,
  contract, and hash failures. Retry readiness manually after the dependency is
  healthy. Never substitute fixtures in production.
- **Schema mismatch:** stop Query and Explore verification. Compare against the
  pinned frozen MCP contract; do not edit contract bytes to accept drift.
- **AI Gateway unavailable:** distinguish authentication/configuration, budget
  (402), rate limit (429), and temporary provider failure (503). Do not add a
  fallback model or retry a live call without authorization.
- **Privacy or grounding rejection:** preserve fail-closed behavior. Reproduce
  with mock models and synthetic sentinels; never log the rejected text or raw
  records.
- **Neon unavailable:** keep Oracle search separate from lead persistence.
  Confirm `DATABASE_URL` scope and pooled runtime use without printing it. Do
  not apply or rewrite migrations during incident triage.
- **Session failure:** confirm `SESSION_SECRET` exists in the affected Vercel
  scope and remains at least 32 characters. Never rotate it casually because
  anonymous sessions would become inaccessible.

The manual live-MCP GitHub workflow is read-only and intentionally non-mandatory
for pull requests. It requires an operator-supplied public endpoint and contains
no deployment or publication credentials.
