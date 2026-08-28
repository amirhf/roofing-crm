import { assertValidSearchArguments, validateOracleToolResult } from "./contracts";
import type {
  GetPermitInput,
  GetPropertyInput,
  JsonObject,
  NodeEnvironment,
  OracleClient,
  OracleMcpToolName,
  OracleMcpTransport,
  OracleResult,
  Permit,
  Property,
  SearchArguments,
  SearchResultData,
} from "./types";

const PROPERTY_ID_PATTERN = /^prop_[a-f0-9]{32}$/;
const PERMIT_ID_PATTERN = /^perm_[a-f0-9]{32}$/;

export class OracleInputValidationError extends Error {
  constructor(field: string) {
    super(
      `Oracle input validation failed: ${field} does not match the frozen identifier shape.`,
    );
    this.name = "OracleInputValidationError";
  }
}

export class ContractValidatingOracleClient implements OracleClient {
  constructor(
    private readonly transport: OracleMcpTransport,
    private readonly nodeEnvironment: NodeEnvironment,
  ) {}

  private async call<T>(
    tool: OracleMcpToolName,
    input: Readonly<Record<string, unknown>>,
  ): Promise<OracleResult<T>> {
    const result = await this.transport.callTool(tool, input);
    return validateOracleToolResult<T>(tool, result, this.nodeEnvironment);
  }

  getServiceInfo(): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_service_info", {});
  }

  getPipelineRunSummary(input: JsonObject = {}): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_pipeline_run_summary", input);
  }

  searchRoofingOpportunities(
    input: SearchArguments,
  ): Promise<OracleResult<SearchResultData>> {
    assertValidSearchArguments(input);
    return this.call("prism_v1_search_roofing_opportunities", { ...input });
  }

  getProperty(input: GetPropertyInput): Promise<OracleResult<Property>> {
    if (!PROPERTY_ID_PATTERN.test(input.propertyId)) {
      throw new OracleInputValidationError("propertyId");
    }
    return this.call("prism_v1_get_property", { ...input });
  }

  getPermit(input: GetPermitInput): Promise<OracleResult<Permit>> {
    if (!PERMIT_ID_PATTERN.test(input.permitId)) {
      throw new OracleInputValidationError("permitId");
    }
    return this.call("prism_v1_get_permit", { ...input });
  }

  getQuerySchema(): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_query_schema", {});
  }
}
