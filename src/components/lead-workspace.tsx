"use client";

import { useEffect, useState } from "react";

import { CRM_LEAD_STATUSES, type CrmLead } from "@/crm/lead";

interface LeadWorkspaceProps {
  readonly refreshKey: number;
}

export function LeadWorkspace({ refreshKey }: LeadWorkspaceProps) {
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [status, setStatus] = useState<CrmLead["status"]>("new");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("Loading leads…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/leads", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Leads could not be loaded.");
        return (await response.json()) as { leads: CrmLead[] };
      })
      .then(({ leads: incoming }) => {
        if (!active) return;
        setLeads(incoming);
        setMessage(incoming.length ? "" : "No leads yet. Create one from Explore.");
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Leads could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function openLead(leadId: string) {
    setMessage("Loading lead…");
    const response = await fetch(`/api/leads/${leadId}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("Lead could not be opened.");
      return;
    }
    const payload = (await response.json()) as { lead: CrmLead };
    setSelected(payload.lead);
    setStatus(payload.lead.status);
    setNotes(payload.lead.notes);
    setMessage("");
  }

  async function saveLead(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/leads/${selected.leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      });
      if (!response.ok) throw new Error("Lead changes could not be saved.");
      const payload = (await response.json()) as { lead: CrmLead };
      setSelected(payload.lead);
      setLeads((current) =>
        current.map((lead) =>
          lead.leadId === payload.lead.leadId ? payload.lead : lead,
        ),
      );
      setMessage("Lead updated.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Lead changes could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="lead-workspace" aria-labelledby="lead-heading">
      <header className="view-heading">
        <p className="eyebrow">Anonymous workspace</p>
        <h1 id="lead-heading">Your leads</h1>
        <p>Saved for this signed browser session for seven days.</p>
      </header>
      <div className="lead-grid">
        <div className="lead-list" aria-label="Lead list">
          {leads.map((lead) => (
            <button
              type="button"
              key={lead.leadId}
              onClick={() => void openLead(lead.leadId)}
              className={
                selected?.leadId === lead.leadId ? "lead-row selected" : "lead-row"
              }
            >
              <span>{lead.propertyId}</span>
              <strong>{lead.status}</strong>
              <small>Updated {new Date(lead.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          <p className="workspace-message" aria-live="polite">
            {message}
          </p>
        </div>
        {selected ? (
          <form className="lead-editor" onSubmit={(event) => void saveLead(event)}>
            <p className="eyebrow">Lead record</p>
            <h2>{selected.propertyId}</h2>
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as CrmLead["status"])}
              >
                {CRM_LEAD_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea
                value={notes}
                maxLength={10000}
                onChange={(event) => setNotes(event.target.value)}
                rows={7}
              />
            </label>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? "Saving…" : "Save lead"}
            </button>
          </form>
        ) : (
          <div className="lead-editor empty-panel">
            <h2>Select a lead</h2>
            <p>Open a record to update its status and notes.</p>
          </div>
        )}
      </div>
    </section>
  );
}
