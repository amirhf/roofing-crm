import {
  ContractValidationError,
  OracleSchemaHashMismatchError,
} from "@/oracle/contracts";
import {
  OracleMcpResponseSizeError,
  OracleMcpTransportError,
} from "@/oracle/mcp-transport";
import { OracleReadinessError } from "@/oracle/readiness";

export type OracleSearchStatusCategory =
  | "contract_validation"
  | "http_502"
  | "http_503"
  | "http_504"
  | "mcp_transport"
  | "oracle_timeout"
  | "response_size"
  | "readiness_validation"
  | "schema_hash_mismatch"
  | "unknown";

export interface OracleSearchErrorClassification {
  readonly errorClass: string;
  readonly statusCategory: OracleSearchStatusCategory;
}

function causes(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function statusCode(error: unknown): 502 | 503 | 504 | null {
  for (const entry of causes(error)) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = Reflect.get(entry, "statusCode");
    if (candidate === 502 || candidate === 503 || candidate === 504) {
      return candidate;
    }
    const status = Reflect.get(entry, "status");
    if (status === 502 || status === 503 || status === 504) return status;
    const code = Reflect.get(entry, "code");
    if (code === 502 || code === 503 || code === 504) return code;
  }
  return null;
}

export function classifyOracleSearchError(
  error: unknown,
): OracleSearchErrorClassification {
  const chain = causes(error);
  if (chain.some((entry) => entry instanceof OracleMcpResponseSizeError)) {
    return {
      errorClass: "OracleMcpResponseSizeError",
      statusCategory: "response_size",
    };
  }
  if (chain.some((entry) => entry instanceof OracleSchemaHashMismatchError)) {
    return {
      errorClass: "OracleSchemaHashMismatchError",
      statusCategory: "schema_hash_mismatch",
    };
  }
  if (chain.some((entry) => entry instanceof ContractValidationError)) {
    return {
      errorClass: "ContractValidationError",
      statusCategory: "contract_validation",
    };
  }
  const status = statusCode(error);
  if (status !== null) {
    return {
      errorClass: "OracleMcpTransportError",
      statusCategory: `http_${status}`,
    };
  }
  if (
    chain.some(
      (entry) =>
        entry instanceof Error &&
        (entry.name === "TimeoutError" || entry.name === "AbortError"),
    )
  ) {
    return {
      errorClass: "OracleMcpTransportError",
      statusCategory: "oracle_timeout",
    };
  }
  if (chain.some((entry) => entry instanceof OracleMcpTransportError)) {
    return {
      errorClass: "OracleMcpTransportError",
      statusCategory: "mcp_transport",
    };
  }
  if (error instanceof OracleReadinessError) {
    return {
      errorClass: "OracleReadinessError",
      statusCategory: "readiness_validation",
    };
  }
  return { errorClass: "UnknownError", statusCategory: "unknown" };
}
