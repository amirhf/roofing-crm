import { describe, expect, it } from "vitest";

import { DevelopmentMemoryLeadRepository } from "../src/crm/memory-repository";
import { createLead, updateLead } from "../src/crm/service";

const sessionA = `sha256:${"a".repeat(64)}` as const;
const sessionB = `sha256:${"b".repeat(64)}` as const;
const input = {
  propertyId: "prop_e72ba795455c19d71ce4cb11f6177a5e" as const,
  permitId: null,
  oracleSchemaHash: "714ee037ffca1362870a5135328a783bfe4a0161e7136e09d4d1590894211de7",
  sourcePublicationCid: null,
  sourceCapturedAt: "2026-08-28T00:00:00.000Z",
};

describe("lead repository boundary", () => {
  it("creates, lists, reads, and updates only within the hashed session", async () => {
    const repository = new DevelopmentMemoryLeadRepository("test");
    const lead = await createLead(
      repository,
      sessionA,
      "2026-09-04T10:00:00.000Z",
      input,
      new Date("2026-08-28T10:00:00.000Z"),
    );
    expect(
      await repository.list(sessionA, new Date("2026-08-29T00:00:00Z")),
    ).toHaveLength(1);
    expect(
      await repository.find(sessionB, lead.leadId, new Date("2026-08-29T00:00:00Z")),
    ).toBeNull();

    const updated = await updateLead(
      repository,
      sessionA,
      lead.leadId,
      { status: "qualified", notes: "Call after 4 PM" },
      new Date("2026-08-29T01:00:00.000Z"),
    );
    expect(updated).toMatchObject({ status: "qualified", notes: "Call after 4 PM" });
  });

  it("cleans up expired records opportunistically", async () => {
    const repository = new DevelopmentMemoryLeadRepository("test");
    await createLead(
      repository,
      sessionA,
      "2026-08-29T00:00:00.000Z",
      input,
      new Date("2026-08-28T00:00:00.000Z"),
    );
    expect(await repository.cleanupExpired(new Date("2026-08-29T00:00:01.000Z"))).toBe(1);
    expect(await repository.list(sessionA, new Date("2026-08-29T00:00:01.000Z"))).toEqual(
      [],
    );
  });

  it("cannot be constructed for production", () => {
    expect(() => new DevelopmentMemoryLeadRepository("production" as never)).toThrow(
      /development\/test-only/,
    );
  });
});
