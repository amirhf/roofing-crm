import { describe, expect, it } from "vitest";

import {
  SESSION_DURATION_SECONDS,
  assertSameOrigin,
  resolveAnonymousSession,
  SameOriginError,
} from "../src/server/session";

const secret = "0123456789abcdef0123456789abcdef";
const now = new Date("2026-08-28T10:00:00.000Z");

describe("anonymous session boundary", () => {
  it("issues a signed HttpOnly Secure cookie with a seven-day expiry", () => {
    const session = resolveAnonymousSession(null, secret, now);
    expect(session.setCookieHeader).toContain("HttpOnly");
    expect(session.setCookieHeader).toContain("Secure");
    expect(session.setCookieHeader).toContain("SameSite=Lax");
    expect(session.setCookieHeader).toContain(`Max-Age=${SESSION_DURATION_SECONDS}`);
    expect(session.sessionIdHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(session.expiresAt).toBe("2026-09-04T10:00:00.000Z");
  });

  it("reuses a valid cookie and rejects a tampered signature", () => {
    const issued = resolveAnonymousSession(null, secret, now);
    const cookie = issued.setCookieHeader!.split(";", 1)[0]!;
    const reused = resolveAnonymousSession(
      cookie,
      secret,
      new Date(now.getTime() + 1_000),
    );
    expect(reused.sessionIdHash).toBe(issued.sessionIdHash);
    expect(reused.setCookieHeader).toBeNull();

    const tampered = resolveAnonymousSession(`${cookie}x`, secret, now);
    expect(tampered.sessionIdHash).not.toBe(issued.sessionIdHash);
    expect(tampered.setCookieHeader).not.toBeNull();
  });

  it("requires same-origin mutation requests", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://roofline.example/api/leads", {
          method: "POST",
          headers: { Origin: "https://roofline.example" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("https://roofline.example/api/leads", {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
        }),
      ),
    ).toThrow(SameOriginError);
    expect(() =>
      assertSameOrigin(
        new Request("https://roofline.example/api/leads", {
          method: "POST",
          headers: { Origin: "not-a-url" },
        }),
      ),
    ).toThrow(SameOriginError);
  });
});
