import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { assertValidCrmLead, type CrmLead } from "./lead";
import type { LeadRepository } from "./repository";

type LeadRow = {
  lead_id: string;
  session_id_hash: string;
  oracle_reference_key: string;
  oracle_contract_version: string;
  oracle_schema_hash: string;
  property_id: string;
  permit_id: string | null;
  source_publication_cid: string | null;
  source_captured_at: string | Date;
  status: string;
  notes: string;
  created_at: string | Date;
  updated_at: string | Date;
  session_expires_at: string | Date;
};

const RETURNING_COLUMNS = `
  lead_id, session_id_hash, oracle_reference_key, oracle_contract_version,
  oracle_schema_hash, property_id, permit_id, source_publication_cid,
  source_captured_at, status, notes, created_at, updated_at, session_expires_at
`;

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function fromRow(row: LeadRow): CrmLead {
  const lead = {
    contractVersion: "1.0.0",
    leadId: row.lead_id,
    sessionIdHash: row.session_id_hash,
    oracleReferenceKey: row.oracle_reference_key,
    oracleContractVersion: row.oracle_contract_version,
    oracleSchemaHash: row.oracle_schema_hash,
    propertyId: row.property_id,
    permitId: row.permit_id,
    sourcePublicationCid: row.source_publication_cid,
    sourceCapturedAt: iso(row.source_captured_at),
    status: row.status,
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    sessionExpiresAt: iso(row.session_expires_at),
  };
  assertValidCrmLead(lead);
  return lead;
}

export class NeonLeadRepository implements LeadRepository {
  private readonly sql: NeonQueryFunction<false, false>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async cleanupExpired(now: Date): Promise<number> {
    const result = await this.sql.query<false, true>(
      "DELETE FROM crm_leads WHERE session_expires_at <= $1 RETURNING lead_id",
      [now.toISOString()],
      { fullResults: true },
    );
    return result.rowCount;
  }

  async create(lead: CrmLead): Promise<CrmLead> {
    assertValidCrmLead(lead);
    await this.cleanupExpired(new Date());
    const rows = await this.sql.query(
      `INSERT INTO crm_leads (
         lead_id, session_id_hash, oracle_reference_key, oracle_contract_version,
         oracle_schema_hash, property_id, permit_id, source_publication_cid,
         source_captured_at, status, notes, created_at, updated_at, session_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (session_id_hash, oracle_reference_key)
       DO UPDATE SET oracle_reference_key = EXCLUDED.oracle_reference_key
       RETURNING ${RETURNING_COLUMNS}`,
      [
        lead.leadId,
        lead.sessionIdHash,
        lead.oracleReferenceKey,
        lead.oracleContractVersion,
        lead.oracleSchemaHash,
        lead.propertyId,
        lead.permitId,
        lead.sourcePublicationCid,
        lead.sourceCapturedAt,
        lead.status,
        lead.notes,
        lead.createdAt,
        lead.updatedAt,
        lead.sessionExpiresAt,
      ],
    );
    return fromRow(rows[0] as LeadRow);
  }

  async list(sessionIdHash: CrmLead["sessionIdHash"], now: Date): Promise<CrmLead[]> {
    await this.cleanupExpired(now);
    const rows = await this.sql.query(
      `SELECT ${RETURNING_COLUMNS}
       FROM crm_leads
       WHERE session_id_hash = $1 AND session_expires_at > $2
       ORDER BY updated_at DESC`,
      [sessionIdHash, now.toISOString()],
    );
    return (rows as LeadRow[]).map(fromRow);
  }

  async find(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    now: Date,
  ): Promise<CrmLead | null> {
    await this.cleanupExpired(now);
    const rows = await this.sql.query(
      `SELECT ${RETURNING_COLUMNS}
       FROM crm_leads
       WHERE session_id_hash = $1 AND lead_id = $2 AND session_expires_at > $3
       LIMIT 1`,
      [sessionIdHash, leadId, now.toISOString()],
    );
    return rows[0] ? fromRow(rows[0] as LeadRow) : null;
  }

  async update(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    changes: Readonly<Pick<CrmLead, "status" | "notes" | "updatedAt">>,
    now: Date,
  ): Promise<CrmLead | null> {
    await this.cleanupExpired(now);
    const rows = await this.sql.query(
      `UPDATE crm_leads
       SET status = $3, notes = $4, updated_at = $5
       WHERE session_id_hash = $1 AND lead_id = $2 AND session_expires_at > $6
       RETURNING ${RETURNING_COLUMNS}`,
      [
        sessionIdHash,
        leadId,
        changes.status,
        changes.notes,
        changes.updatedAt,
        now.toISOString(),
      ],
    );
    return rows[0] ? fromRow(rows[0] as LeadRow) : null;
  }
}
