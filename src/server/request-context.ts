import { loadApplicationRuntimeConfig } from "@/config/runtime";
import { getLeadRepository } from "@/crm/repository-factory";

import { resolveAnonymousSession } from "./session";

export function createLeadRequestContext(request: Request) {
  const config = loadApplicationRuntimeConfig(process.env);
  const session = resolveAnonymousSession(
    request.headers.get("cookie"),
    config.sessionSecret,
  );
  return {
    config,
    repository: getLeadRepository(config),
    session,
  };
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
  setCookieHeader: string | null = null,
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);
  return new Response(JSON.stringify(body), { ...init, headers });
}
