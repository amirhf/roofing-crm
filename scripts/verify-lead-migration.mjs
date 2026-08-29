import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const POSTGRES_BIN = process.env.POSTGRES_BIN_DIR;
const FIRST_ORACLE_HASH =
  "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7";
const SECOND_ORACLE_HASH =
  "1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5";
const ACTIVE_ORACLE_HASH =
  "9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131";
const workspace = resolve(import.meta.dirname, "..");
const migrationOne = readFileSync(
  join(workspace, "migrations/001_create_crm_leads.sql"),
  "utf8",
);
const migrationTwo = readFileSync(
  join(workspace, "migrations/002_adopt_lead_contract_v1_1.sql"),
  "utf8",
);

function binary(name) {
  return POSTGRES_BIN ? join(POSTGRES_BIN, name) : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command.split("/").at(-1)} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.trim();
}

async function openPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a disposable PostgreSQL port.");
  }
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

function psql(port, sql, expectFailure = false) {
  const result = spawnSync(
    binary("psql"),
    [
      "-X",
      "-qAt",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql, encoding: "utf8", timeout: 30_000 },
  );
  if (expectFailure) {
    if (result.status === 0) throw new Error("Expected migration failure did not occur.");
    return result.stderr;
  }
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function insertBaselineRow(
  index,
  hash,
  sessionDigit = String(index),
  propertyDigit = String(index),
) {
  const digit = String(index).padStart(2, "0");
  return `
    INSERT INTO crm_leads (
      lead_id, session_id_hash, oracle_reference_key, oracle_contract_version,
      oracle_schema_hash, property_id, permit_id, source_publication_cid,
      source_captured_at, status, notes, created_at, updated_at, session_expires_at
    ) VALUES (
      '00000000-0000-4000-8000-0000000000${digit}',
      'sha256:${sessionDigit.repeat(64)}',
      'leadref_${String(index).repeat(32)}',
      '1.0.0', '${hash}', 'prop_${propertyDigit.repeat(32)}', NULL, NULL,
      '2026-08-28T00:00:00Z', 'new', '', '2026-08-28T00:00:00Z',
      '2026-08-28T00:00:00Z', '2026-09-04T00:00:00Z'
    );`;
}

function concurrentPsql(port, sql) {
  return new Promise((resolveChild, reject) => {
    const child = spawn(binary("psql"), [
      "-X",
      "-qAt",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveChild(stdout.trim());
      else reject(new Error(`concurrent psql failed: ${stderr.trim()}`));
    });
    child.stdin.end(sql);
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "roofline-lead-migration-"));
  const dataDirectory = join(root, "postgres-data");
  const port = await openPort();
  let started = false;
  try {
    run(binary("initdb"), [
      "-D",
      dataDirectory,
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    run(binary("pg_ctl"), [
      "-D",
      dataDirectory,
      "-l",
      join(root, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "-w",
      "start",
    ]);
    started = true;

    psql(port, 'CREATE SCHEMA "known_pairs";');
    psql(
      port,
      `SET search_path TO "known_pairs";\n${migrationOne}\n${insertBaselineRow(1, FIRST_ORACLE_HASH)}\n${insertBaselineRow(2, SECOND_ORACLE_HASH)}\n${insertBaselineRow(3, ACTIVE_ORACLE_HASH)}`,
    );
    psql(port, `SET search_path TO "known_pairs";\n${migrationTwo}`);
    const mapped = psql(
      port,
      `SET search_path TO "known_pairs";
       SELECT oracle_source_contract_version || ':' || oracle_contract_hash
       FROM crm_leads ORDER BY oracle_contract_hash;`,
    );
    for (const expected of [
      `1.0.0:${FIRST_ORACLE_HASH}`,
      `1.1.0:${SECOND_ORACLE_HASH}`,
      `1.2.0:${ACTIVE_ORACLE_HASH}`,
    ]) {
      if (!mapped.includes(expected)) throw new Error(`Missing mapped pair ${expected}.`);
    }
    psql(port, `SET search_path TO "known_pairs";\n${migrationTwo}`);

    psql(
      port,
      `SET search_path TO "known_pairs";\n${insertBaselineRow(7, ACTIVE_ORACLE_HASH)}`,
    );
    const legacyWrite = psql(
      port,
      `SET search_path TO "known_pairs";
       SELECT lead_contract_version || ':' || oracle_source_contract_version || ':' || oracle_contract_hash
       FROM crm_leads WHERE lead_id = '00000000-0000-4000-8000-000000000007';`,
    );
    if (legacyWrite !== `1.1.0:1.2.0:${ACTIVE_ORACLE_HASH}`) {
      throw new Error(
        "Legacy-shape insert was not expanded by the compatibility trigger.",
      );
    }

    const duplicateSql = (leadId, referenceKey) => `
      SET search_path TO "known_pairs";
      INSERT INTO crm_leads (
        lead_id, session_id_hash, oracle_reference_key, lead_contract_version,
        oracle_contract_version, oracle_source_contract_version,
        oracle_contract_hash, oracle_schema_hash,
        property_id, permit_id, source_publication_cid, source_captured_at,
        status, notes, created_at, updated_at, session_expires_at
      ) VALUES (
        '${leadId}', 'sha256:${"a".repeat(64)}', '${referenceKey}', '1.1.0',
        '1.0.0', '1.2.0', '${ACTIVE_ORACLE_HASH}', '${ACTIVE_ORACLE_HASH}',
        'prop_${"f".repeat(32)}', NULL, NULL, '2026-08-28T00:00:00Z',
        'new', '', NOW(), NOW(), '2026-09-04T00:00:00Z'
      )
      ON CONFLICT (session_id_hash, property_id, (COALESCE(permit_id, '')))
      DO UPDATE SET oracle_reference_key = EXCLUDED.oracle_reference_key
      RETURNING lead_id;`;
    const duplicateIds = await Promise.all([
      concurrentPsql(
        port,
        duplicateSql("00000000-0000-4000-8000-000000000010", `leadref_${"c".repeat(32)}`),
      ),
      concurrentPsql(
        port,
        duplicateSql("00000000-0000-4000-8000-000000000011", `leadref_${"d".repeat(32)}`),
      ),
    ]);
    if (new Set(duplicateIds).size !== 1) {
      throw new Error("Concurrent duplicate creation returned different lead IDs.");
    }

    psql(port, 'CREATE SCHEMA "unknown_pair";');
    psql(
      port,
      `SET search_path TO "unknown_pair";\n${migrationOne}\n${insertBaselineRow(4, "0".repeat(64))}`,
    );
    psql(port, `SET search_path TO "unknown_pair";\n${migrationTwo}`, true);
    const addedColumns = psql(
      port,
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'unknown_pair' AND table_name = 'crm_leads'
       AND column_name IN (
         'lead_contract_version',
         'oracle_source_contract_version',
         'oracle_contract_hash'
       );`,
    );
    if (addedColumns !== "0") {
      throw new Error("Unknown-pair failure did not roll the migration back.");
    }

    psql(port, 'CREATE SCHEMA "duplicate_identity";');
    psql(
      port,
      `SET search_path TO "duplicate_identity";
       ${migrationOne}
       ${insertBaselineRow(5, FIRST_ORACLE_HASH, "e", "f")}
       ${insertBaselineRow(6, ACTIVE_ORACLE_HASH, "e", "f")}`,
    );
    const duplicateFailure = psql(
      port,
      `SET search_path TO "duplicate_identity";\n${migrationTwo}`,
      true,
    );
    if (!duplicateFailure.includes("CRM_LEAD_DUPLICATE_PREFLIGHT")) {
      throw new Error("Historical duplicates did not raise the named preflight error.");
    }
    const duplicateAddedColumns = psql(
      port,
      `SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'duplicate_identity' AND table_name = 'crm_leads'
       AND column_name IN (
         'lead_contract_version',
         'oracle_source_contract_version',
         'oracle_contract_hash'
       );`,
    );
    if (duplicateAddedColumns !== "0") {
      throw new Error("Duplicate-preflight failure did not leave migration 001 intact.");
    }

    process.stdout.write(
      "Disposable PostgreSQL migration verification passed: mapping, legacy/new writer compatibility, replay, named duplicate/unknown rollback, and concurrent duplicate identity.\n",
    );
  } finally {
    if (started) {
      spawnSync(binary("pg_ctl"), ["-D", dataDirectory, "-m", "fast", "-w", "stop"], {
        encoding: "utf8",
        timeout: 30_000,
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
