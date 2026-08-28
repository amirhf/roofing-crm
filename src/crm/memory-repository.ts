import { assertValidCrmLead, type CrmLead } from "./lead";
import type { LeadRepository } from "./repository";

export class DevelopmentMemoryLeadRepository implements LeadRepository {
  private readonly leads = new Map<string, CrmLead>();

  constructor(environment: "development" | "test") {
    if (environment !== "development" && environment !== "test") {
      throw new Error("The in-memory lead repository is development/test-only.");
    }
  }

  async cleanupExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [key, lead] of this.leads) {
      if (Date.parse(lead.sessionExpiresAt) <= now.getTime()) {
        this.leads.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async create(lead: CrmLead): Promise<CrmLead> {
    assertValidCrmLead(lead);
    await this.cleanupExpired(new Date());
    const duplicate = [...this.leads.values()].find(
      (candidate) =>
        candidate.sessionIdHash === lead.sessionIdHash &&
        candidate.oracleReferenceKey === lead.oracleReferenceKey,
    );
    if (duplicate) return duplicate;
    this.leads.set(lead.leadId, structuredClone(lead));
    return structuredClone(lead);
  }

  async list(sessionIdHash: CrmLead["sessionIdHash"], now: Date): Promise<CrmLead[]> {
    await this.cleanupExpired(now);
    return [...this.leads.values()]
      .filter((lead) => lead.sessionIdHash === sessionIdHash)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((lead) => structuredClone(lead));
  }

  async find(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    now: Date,
  ): Promise<CrmLead | null> {
    await this.cleanupExpired(now);
    const lead = this.leads.get(leadId);
    return lead?.sessionIdHash === sessionIdHash ? structuredClone(lead) : null;
  }

  async update(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    changes: Readonly<Pick<CrmLead, "status" | "notes" | "updatedAt">>,
    now: Date,
  ): Promise<CrmLead | null> {
    const lead = await this.find(sessionIdHash, leadId, now);
    if (!lead) return null;
    const updated: CrmLead = { ...lead, ...changes };
    assertValidCrmLead(updated);
    this.leads.set(leadId, updated);
    return structuredClone(updated);
  }
}
