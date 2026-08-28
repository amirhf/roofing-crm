import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const SESSION_COOKIE_NAME = "roofline_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export interface AnonymousSession {
  readonly sessionIdHash: `sha256:${string}`;
  readonly expiresAt: string;
  readonly setCookieHeader: string | null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return valueParts.join("=");
  }
  return null;
}

function parseValidPayload(
  token: string | null,
  secret: string,
  nowMs: number,
): { payload: string; issuedAtMs: number } | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!secureEqual(signature, sign(payload, secret))) return null;
  const issuedAtSeconds = Number(payload.split(".", 1)[0]);
  if (!Number.isInteger(issuedAtSeconds)) return null;
  const issuedAtMs = issuedAtSeconds * 1000;
  const ageMs = nowMs - issuedAtMs;
  if (ageMs < 0 || ageMs >= SESSION_DURATION_SECONDS * 1000) return null;
  return { payload, issuedAtMs };
}

function sessionHash(payload: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function resolveAnonymousSession(
  cookieHeader: string | null,
  secret: string,
  now = new Date(),
): AnonymousSession {
  const existing = parseValidPayload(
    cookieValue(cookieHeader, SESSION_COOKIE_NAME),
    secret,
    now.getTime(),
  );
  const payload =
    existing?.payload ??
    `${Math.floor(now.getTime() / 1000)}.${randomBytes(32).toString("base64url")}`;
  const issuedAtMs = existing?.issuedAtMs ?? Math.floor(now.getTime() / 1000) * 1000;
  const expiresAt = new Date(issuedAtMs + SESSION_DURATION_SECONDS * 1000).toISOString();
  const token = `${payload}.${sign(payload, secret)}`;

  return {
    sessionIdHash: sessionHash(payload),
    expiresAt,
    setCookieHeader: existing
      ? null
      : `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_DURATION_SECONDS}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Lax`,
  };
}

export class SameOriginError extends Error {
  constructor() {
    super("State-changing requests require a matching Origin header.");
    this.name = "SameOriginError";
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new SameOriginError();
  }
  const requestUrl = new URL(request.url);
  const expectedHost =
    request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() ||
    request.headers.get("host") ||
    requestUrl.host;
  const expectedProtocol =
    request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() ||
    requestUrl.protocol.slice(0, -1);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new SameOriginError();
  }
  if (originUrl.host !== expectedHost || originUrl.protocol !== `${expectedProtocol}:`) {
    throw new SameOriginError();
  }
}
