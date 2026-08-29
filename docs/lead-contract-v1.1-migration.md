# CRM lead contract v1.1 migration runbook

Migration `002_adopt_lead_contract_v1_1.sql` is an expand migration. Apply it
before deploying code that reads the v1.1 columns. The migration preserves the
legacy `oracle_contract_version` and `oracle_schema_hash` columns so already
running v1.0 application instances can continue reading and writing while a
rolling deployment replaces them. A trigger derives and validates the new lead
contract and Oracle source-version/hash fields for both old and new writers.

## Duplicate preflight

Migration 001 allowed distinct reference keys for the same anonymous session,
property and optional permit. Migration 002 does not merge those rows because
their status, notes and provenance can differ. It raises the named
`CRM_LEAD_DUPLICATE_PREFLIGHT` exception before changing the table.

Run this read-only query before migration:

```sql
SELECT
  session_id_hash,
  property_id,
  COALESCE(permit_id, '') AS permit_identity,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(lead_id ORDER BY created_at, lead_id) AS lead_ids
FROM crm_leads
GROUP BY session_id_hash, property_id, COALESCE(permit_id, '')
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, session_id_hash, property_id, permit_identity;
```

If it returns rows, stop. Export every conflicting row to a protected operator
backup, review status and notes, and choose one canonical lead per identity.
Merge CRM-owned notes/status deliberately before removing superseded rows; do
not discard or overwrite Oracle provenance. Record the reconciliation and rerun
the query until it returns no rows. The migration must not be modified to delete
duplicates automatically.

## Rollout order

1. Back up the CRM database and run the duplicate preflight.
2. Apply migrations 001 then 002 through the deployment database checkpoint.
3. Verify old-shape and v1.1-shape synthetic inserts in a non-production
   database.
4. Deploy the v1.1-compatible application and wait for old instances and
   in-flight requests to drain.
5. Verify lead create/read/update, duplicate behavior and session isolation.

No contract/drop migration is part of this checkpoint. The legacy columns and
compatibility trigger remain until a separately reviewed deployment proves old
instances are gone. This local migration verifier does not prove Neon behavior.
