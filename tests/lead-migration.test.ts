import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../migrations/002_adopt_lead_contract_v1_1.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../src/crm/neon-repository.ts", import.meta.url);

describe("CRM lead v1.1 migration", () => {
  it("adds versioned provenance columns without replacing the lead table", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql.trimStart()).toMatch(/^BEGIN;/);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
    expect(sql).toContain("LOCK TABLE crm_leads IN ACCESS EXCLUSIVE MODE");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lead_contract_version text/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS oracle_source_contract_version text/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS oracle_contract_hash text/);
    expect(sql).toMatch(
      /oracle_contract_hash = COALESCE\(oracle_contract_hash, oracle_schema_hash\)/,
    );
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });

  it("maps the baseline hash to its real Oracle version and fails unknown rows atomically", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "WHEN '9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131' THEN '1.2.0'",
    );
    expect(sql).toContain("CRM_LEAD_UNKNOWN_ORACLE_HASH: migration rolled back");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS lead_contract_version/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/);
  });

  it("establishes stable duplicate identity from session, property, and permit", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("CRM_LEAD_DUPLICATE_PREFLIGHT");
    expect(sql).toMatch(/GROUP BY session_id_hash, property_id, COALESCE\(permit_id/);
    expect(sql).toContain("crm_leads_session_property_permit_unique_idx");
    expect(sql).toContain(
      "ON crm_leads (session_id_hash, property_id, COALESCE(permit_id, ''))",
    );
  });

  it("couples every supported Oracle version to its exact contract hash", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "oracle_source_contract_version = '1.0.0' AND oracle_contract_hash = '714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7'",
    );
    expect(sql).toContain(
      "oracle_source_contract_version = '1.1.0' AND oracle_contract_hash = '1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5'",
    );
    expect(sql).toContain(
      "oracle_source_contract_version = '1.2.0' AND oracle_contract_hash = '9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131'",
    );
  });

  it("keeps legacy writers compatible during migration-first rollout", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("crm_leads_sync_v1_1_provenance");
    expect(sql).not.toMatch(/DROP CONSTRAINT.*oracle_contract_version_check/);
    expect(sql).toContain("NEW.oracle_contract_hash");
    expect(sql).toContain("NEW.oracle_source_contract_version");

    const repository = await readFile(repositoryUrl, "utf8");
    expect(repository).toContain("oracle_source_contract_version");
    expect(repository).toMatch(/VALUES \(\$1, \$2, \$3, \$4, '1\.0\.0', \$5, \$6, \$7/);
  });

  it("does not add Oracle owner or contact snapshots", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toMatch(/owner|mailing|phone|email/i);
  });
});
