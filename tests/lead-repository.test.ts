import { describe, expect, it } from "vitest";

import { DevelopmentMemoryLeadRepository } from "../src/crm/memory-repository";
import {
  createLead,
  LeadOracleProvenanceError,
  LeadOracleUnavailableError,
  resolveLeadOracleProvenance,
  updateLead,
} from "../src/crm/service";
import { DevelopmentFixtureOracleClient } from "../src/oracle/fixture-adapter";
import type { OracleClient } from "../src/oracle/types";

const sessionA = `sha256:${"a".repeat(64)}` as const;
const sessionB = `sha256:${"b".repeat(64)}` as const;
const input = {
  propertyId: "prop_e72ba795455c19d71ce4cb11f6177a5e" as const,
  permitId: null,
};
const provenance = {
  oracleContractVersion: "1.2.0" as const,
  oracleContractHash: "9fc112ef8a4e2120593c3dc20c90073b0eb96596817c96112f63fd258bb7c131",
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
      provenance,
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
      provenance,
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

  it("returns the existing record for an idempotent duplicate", async () => {
    const repository = new DevelopmentMemoryLeadRepository("test");
    const first = await createLead(
      repository,
      sessionA,
      "2026-09-04T10:00:00.000Z",
      input,
      provenance,
      new Date("2026-08-28T10:00:00.000Z"),
    );
    const duplicate = await createLead(
      repository,
      sessionA,
      "2026-09-04T10:00:00.000Z",
      input,
      provenance,
      new Date("2026-08-28T11:00:00.000Z"),
    );
    expect(duplicate.leadId).toBe(first.leadId);
    expect(
      await repository.list(sessionA, new Date("2026-08-29T00:00:00Z")),
    ).toHaveLength(1);
  });

  it("keeps duplicate identity stable when provenance metadata changes", async () => {
    const repository = new DevelopmentMemoryLeadRepository("test");
    const first = await createLead(
      repository,
      sessionA,
      "2026-09-04T10:00:00.000Z",
      input,
      provenance,
      new Date("2026-08-28T10:00:00.000Z"),
    );
    const duplicate = await repository.create({
      ...first,
      leadId: "00000000-0000-4000-8000-000000000002",
      oracleReferenceKey: `leadref_${"b".repeat(32)}`,
      sourcePublicationCid: "bafybeifuturepublication",
      sourceCapturedAt: "2026-08-29T10:00:00.000Z",
    });

    expect(duplicate.leadId).toBe(first.leadId);
    expect(
      await repository.list(sessionA, new Date("2026-08-29T12:00:00Z")),
    ).toHaveLength(1);
  });

  it("allows historical pairs for reads but rejects them for new writes", async () => {
    const repository = new DevelopmentMemoryLeadRepository("test");
    await expect(
      createLead(
        repository,
        sessionA,
        "2026-09-04T10:00:00.000Z",
        input,
        {
          ...provenance,
          oracleContractVersion: "1.1.0",
          oracleContractHash:
            "1ef6f43072bc93ee8557aa9fcd0ce55eab26560fe4d061fac7c9388b2d0301c5",
        },
        new Date("2026-08-28T10:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(LeadOracleProvenanceError);
    expect(await repository.list(sessionA, new Date("2026-08-29T00:00:00Z"))).toEqual([]);
  });

  it("uses one total deadline across property and permit provenance calls", async () => {
    const fixture = new DevelopmentFixtureOracleClient("test");
    let propertySignal: AbortSignal | undefined;
    let permitSignal: AbortSignal | undefined;
    const oracle = {
      getProperty: async (
        propertyInput: Parameters<OracleClient["getProperty"]>[0],
        options?: Parameters<OracleClient["getProperty"]>[1],
      ) => {
        propertySignal = options?.signal;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return fixture.getProperty(propertyInput);
      },
      getPermit: (
        _permitInput: Parameters<OracleClient["getPermit"]>[0],
        options?: Parameters<OracleClient["getPermit"]>[1],
      ) =>
        new Promise<Awaited<ReturnType<OracleClient["getPermit"]>>>(
          (_resolve, reject) => {
            permitSignal = options?.signal;
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          },
        ),
    } as unknown as OracleClient;

    await expect(
      resolveLeadOracleProvenance(
        oracle,
        {
          ...input,
          permitId: "perm_91699de8cc4d322ad6fb183f20ae349e",
        },
        { timeoutMs: 35 },
      ),
    ).rejects.toBeInstanceOf(LeadOracleUnavailableError);
    expect(propertySignal).toBeInstanceOf(AbortSignal);
    expect(permitSignal).toBe(propertySignal);
    expect(permitSignal?.aborted).toBe(true);
  });
});
