import { type NextRequest, NextResponse } from "next/server";

import { loadSessionSecret } from "@/config/runtime";
import { resolveAnonymousSession } from "@/server/session";

export function establishPageSession(
  cookieHeader: string | null,
  sessionSecret: string,
  now = new Date(),
): NextResponse {
  const session = resolveAnonymousSession(cookieHeader, sessionSecret, now);
  const response = NextResponse.next();
  if (session.setCookieHeader) {
    response.headers.append("Set-Cookie", session.setCookieHeader);
  }
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  return establishPageSession(
    request.headers.get("cookie"),
    loadSessionSecret(process.env),
  );
}

export const config = {
  matcher: ["/"],
};
