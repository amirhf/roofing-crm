import { assertValidSearchArguments, validateOracleToolResult } from "./contracts";
import type {
  GetPermitInput,
  GetPropertyInput,
  JsonObject,
  NodeEnvironment,
  OracleCallOptions,
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
    options?: OracleCallOptions,
  ): Promise<OracleResult<T>> {
    const result = await this.transport.callTool(tool, input, options);
    return validateOracleToolResult<T>(tool, result, this.nodeEnvironment);
  }

  getServiceInfo(options?: OracleCallOptions): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_service_info", {}, options);
  }

  getPipelineRunSummary(
    input: JsonObject = {},
    options?: OracleCallOptions,
  ): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_pipeline_run_summary", input, options);
  }

  searchRoofingOpportunities(
    input: SearchArguments,
    options?: OracleCallOptions,
  ): Promise<OracleResult<SearchResultData>> {
    assertValidSearchArguments(input);
    return this.call("prism_v1_search_roofing_opportunities", { ...input }, options);
  }

  getProperty(
    input: GetPropertyInput,
    options?: OracleCallOptions,
  ): Promise<OracleResult<Property>> {
    if (!PROPERTY_ID_PATTERN.test(input.propertyId)) {
      throw new OracleInputValidationError("propertyId");
    }
    return this.call("prism_v1_get_property", { ...input }, options);
  }

  getPermit(
    input: GetPermitInput,
    options?: OracleCallOptions,
  ): Promise<OracleResult<Permit>> {
    if (!PERMIT_ID_PATTERN.test(input.permitId)) {
      throw new OracleInputValidationError("permitId");
    }
    return this.call("prism_v1_get_permit", { ...input }, options);
  }

  getQuerySchema(options?: OracleCallOptions): Promise<OracleResult<JsonObject>> {
    return this.call("prism_v1_get_query_schema", {}, options);
  }
}
