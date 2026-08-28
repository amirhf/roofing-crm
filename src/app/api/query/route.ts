import type { NaturalLanguageQueryResult } from "@/agent/types";
import { jsonResponse } from "@/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const result: NaturalLanguageQueryResult = {
    status: "not_configured",
    message:
      "The live grounded query agent is not configured in this checkpoint. Use structured search controls.",
  };
  return jsonResponse(result, { status: 501 });
}
