BEGIN;

LOCK TABLE crm_leads IN ACCESS EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm_leads
    GROUP BY session_id_hash, property_id, COALESCE(permit_id, '')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CRM_LEAD_DUPLICATE_PREFLIGHT: legacy session/property/permit duplicates require operator reconciliation';
  END IF;
END
$migration$;

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS lead_contract_version text,
  ADD COLUMN IF NOT EXISTS oracle_source_contract_version text,
  ADD COLUMN IF NOT EXISTS oracle_contract_hash text;

CREATE OR REPLACE FUNCTION crm_leads_sync_v1_1_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  expected_source_version text;
BEGIN
  NEW.lead_contract_version := COALESCE(NEW.lead_contract_version, '1.1.0');
  NEW.oracle_contract_hash := COALESCE(NEW.oracle_contract_hash, NEW.oracle_schema_hash);

  IF NEW.oracle_contract_hash IS DISTINCT FROM NEW.oracle_schema_hash THEN
    RAISE EXCEPTION 'CRM_LEAD_PROVENANCE_MISMATCH: oracle hash columns disagree';
  END IF;

  expected_source_version := CASE NEW.oracle_contract_hash
    WHEN '714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7' THEN '1.0.0'
    WHEN '1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5' THEN '1.1.0'
    WHEN '9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131' THEN '1.2.0'
    ELSE NULL
  END;

  IF expected_source_version IS NULL THEN
    RAISE EXCEPTION 'CRM_LEAD_UNKNOWN_ORACLE_HASH: Oracle contract hash is not recognized';
  END IF;
  NEW.oracle_source_contract_version := COALESCE(
    NEW.oracle_source_contract_version,
    expected_source_version
  );
  IF NEW.oracle_source_contract_version IS DISTINCT FROM expected_source_version THEN
    RAISE EXCEPTION 'CRM_LEAD_PROVENANCE_MISMATCH: Oracle source version/hash pair is invalid';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS crm_leads_sync_v1_1_provenance_trigger ON crm_leads;
CREATE TRIGGER crm_leads_sync_v1_1_provenance_trigger
BEFORE INSERT OR UPDATE OF
  oracle_schema_hash,
  oracle_contract_hash,
  oracle_source_contract_version,
  lead_contract_version
ON crm_leads
FOR EACH ROW
EXECUTE FUNCTION crm_leads_sync_v1_1_provenance();

UPDATE crm_leads
SET
  lead_contract_version = COALESCE(lead_contract_version, '1.1.0'),
  oracle_contract_hash = COALESCE(oracle_contract_hash, oracle_schema_hash),
  oracle_source_contract_version = CASE COALESCE(
    oracle_contract_hash,
    oracle_schema_hash
  )
    WHEN '714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7' THEN '1.0.0'
    WHEN '1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5' THEN '1.1.0'
    WHEN '9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131' THEN '1.2.0'
    ELSE NULL
  END;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm_leads
    WHERE oracle_source_contract_version IS NULL
  ) THEN
    RAISE EXCEPTION 'CRM_LEAD_UNKNOWN_ORACLE_HASH: migration rolled back';
  END IF;
END
$migration$;

ALTER TABLE crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_lead_contract_version_check,
  DROP CONSTRAINT IF EXISTS crm_leads_oracle_contract_hash_check,
  DROP CONSTRAINT IF EXISTS crm_leads_oracle_contract_hash_matches_legacy_check,
  DROP CONSTRAINT IF EXISTS crm_leads_oracle_source_contract_pair_check;

ALTER TABLE crm_leads
  ALTER COLUMN lead_contract_version SET NOT NULL,
  ALTER COLUMN oracle_source_contract_version SET NOT NULL,
  ALTER COLUMN oracle_contract_hash SET NOT NULL,
  ADD CONSTRAINT crm_leads_lead_contract_version_check
    CHECK (lead_contract_version = '1.1.0'),
  ADD CONSTRAINT crm_leads_oracle_contract_hash_check
    CHECK (oracle_contract_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT crm_leads_oracle_contract_hash_matches_legacy_check
    CHECK (oracle_contract_hash = oracle_schema_hash),
  ADD CONSTRAINT crm_leads_oracle_source_contract_pair_check
    CHECK (
      (oracle_source_contract_version = '1.0.0' AND oracle_contract_hash = '714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7')
      OR (oracle_source_contract_version = '1.1.0' AND oracle_contract_hash = '1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5')
      OR (oracle_source_contract_version = '1.2.0' AND oracle_contract_hash = '9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131')
    );

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_session_property_permit_unique_idx
  ON crm_leads (session_id_hash, property_id, COALESCE(permit_id, ''));

COMMIT;
