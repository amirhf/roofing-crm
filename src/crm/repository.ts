import type { CrmLead } from "./lead";

export interface LeadRepository {
  cleanupExpired(now: Date): Promise<number>;
  create(lead: CrmLead): Promise<CrmLead>;
  list(sessionIdHash: CrmLead["sessionIdHash"], now: Date): Promise<CrmLead[]>;
  find(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    now: Date,
  ): Promise<CrmLead | null>;
  update(
    sessionIdHash: CrmLead["sessionIdHash"],
    leadId: string,
    changes: Readonly<Pick<CrmLead, "status" | "notes" | "updatedAt">>,
    now: Date,
  ): Promise<CrmLead | null>;
}
