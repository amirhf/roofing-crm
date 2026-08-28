import { loadApplicationRuntimeConfig } from "@/config/runtime";
import {
  assertValidSearchArguments,
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import { createOracleClient } from "@/oracle/factory";
import { jsonResponse } from "@/server/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const input: unknown = await request.json();
    assertValidSearchArguments(input);
    const client = createOracleClient(loadApplicationRuntimeConfig(process.env).oracle);
    const result = await client.searchRoofingOpportunities(input);
    if (!result.ok) {
      const status = result.error.code === "invalid_argument" ? 400 : 503;
      return jsonResponse(result, { status });
    }
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return jsonResponse(
        { error: { code: "invalid_contract", message: error.message } },
        { status: 422 },
      );
    }
    if (error instanceof OracleSchemaHashMismatchError) {
      return jsonResponse(
        { error: { code: "schema_hash_mismatch", message: error.message } },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Oracle request failed.";
    return jsonResponse(
      { error: { code: "oracle_unavailable", message } },
      { status: 503 },
    );
  }
}
