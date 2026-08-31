import { ProductionFixtureSelectionError } from "../config/oracle";

import errorFixture from "../../contracts/fixtures/error-response.json";
import permitFixture from "../../contracts/fixtures/permit-response.json";
import pipelineRunSummaryFixture from "../../contracts/fixtures/pipeline-run-summary-response.json";
import propertyFixture from "../../contracts/fixtures/property-response.json";
import querySchemaFixture from "../../contracts/fixtures/query-schema-response.json";
import searchFixture from "../../contracts/fixtures/search-response.json";
import serviceInfoFixture from "../../contracts/fixtures/service-info-response.json";
import mcpSchema from "../../contracts/mcp-v1.schema.json";
import {
  assertValidMcpFixture,
  assertValidSearchArguments,
  validateOracleToolResult,
} from "./contracts";
import type {
  GetPermitInput,
  GetPropertyInput,
  JsonObject,
  NodeEnvironment,
  OracleClient,
  OracleMcpToolDescriptor,
  OracleResult,
  Permit,
  Property,
  SearchArguments,
  SearchResultData,
} from "./types";

const FIXTURE_TOOL_SCHEMAS = [
  ["prism_v1_get_service_info", "ServiceInfoArguments", "ServiceInfoSuccessResult"],
  [
    "prism_v1_get_pipeline_run_summary",
    "PipelineRunSummaryArguments",
    "PipelineRunSummarySuccessResult",
  ],
  ["prism_v1_search_roofing_opportunities", "SearchArguments", "SearchSuccessResult"],
  ["prism_v1_get_property", "PropertyArguments", "PropertySuccessResult"],
  ["prism_v1_get_permit", "PermitArguments", "PermitSuccessResult"],
  ["prism_v1_get_query_schema", "QuerySchemaArguments", "QuerySchemaSuccessResult"],
] as const;

function fixtureToolDescriptors(): readonly OracleMcpToolDescriptor[] {
  const definitions = mcpSchema.$defs as Readonly<Record<string, unknown>>;
  return FIXTURE_TOOL_SCHEMAS.map(([name, inputDefinition, outputDefinition]) => ({
    name,
    inputSchema: {
      ...(definitions[inputDefinition] as Readonly<Record<string, unknown>>),
      $defs: definitions,
    },
    outputSchema: {
      ...(definitions[outputDefinition] as Readonly<Record<string, unknown>>),
      $defs: definitions,
    },
  }));
}

export class FixtureCoverageError extends Error {
  constructor(tool: string) {
    super(`The development fixture adapter has no frozen success fixture for ${tool}.`);
    this.name = "FixtureCoverageError";
  }
}

export class FixtureRecordNotFoundError extends Error {
  constructor(recordType: string, identifier: string) {
    super(`The development fixtures do not contain ${recordType} ${identifier}.`);
    this.name = "FixtureRecordNotFoundError";
  }
}

function frozenResult<T>(fixture: { readonly result: unknown }): T {
  return structuredClone(fixture.result) as T;
}

export class DevelopmentFixtureOracleClient implements OracleClient {
  constructor(nodeEnvironment: NodeEnvironment) {
    if (nodeEnvironment === "production") {
      throw new ProductionFixtureSelectionError();
    }
    [
      errorFixture,
      permitFixture,
      pipelineRunSummaryFixture,
      propertyFixture,
      querySchemaFixture,
      searchFixture,
      serviceInfoFixture,
    ].forEach((fixture) => assertValidMcpFixture(fixture));
  }

  discoverTools(): Promise<readonly OracleMcpToolDescriptor[]> {
    return Promise.resolve(fixtureToolDescriptors());
  }

  getServiceInfo(): Promise<OracleResult<JsonObject>> {
    return Promise.resolve(
      validateOracleToolResult<JsonObject>(
        "prism_v1_get_service_info",
        frozenResult<unknown>(serviceInfoFixture),
        "test",
      ),
    );
  }

  getPipelineRunSummary(): Promise<OracleResult<JsonObject>> {
    return Promise.resolve(
      validateOracleToolResult<JsonObject>(
        "prism_v1_get_pipeline_run_summary",
        frozenResult<unknown>(pipelineRunSummaryFixture),
        "test",
      ),
    );
  }

  searchRoofingOpportunities(
    input: SearchArguments,
  ): Promise<OracleResult<SearchResultData>> {
    assertValidSearchArguments(input);
    const result = frozenResult<unknown>(searchFixture);
    return Promise.resolve(
      validateOracleToolResult<SearchResultData>(
        "prism_v1_search_roofing_opportunities",
        result,
        "test",
      ),
    );
  }

  getProperty(input: GetPropertyInput): Promise<OracleResult<Property>> {
    if (input.propertyId !== propertyFixture.result.data.propertyId) {
      throw new FixtureRecordNotFoundError("property", input.propertyId);
    }
    const result = frozenResult<unknown>(propertyFixture);
    return Promise.resolve(
      validateOracleToolResult<Property>("prism_v1_get_property", result, "test"),
    );
  }

  getPermit(input: GetPermitInput): Promise<OracleResult<Permit>> {
    if (input.permitId !== permitFixture.result.data.permitId) {
      throw new FixtureRecordNotFoundError("permit", input.permitId);
    }
    const result = frozenResult<unknown>(permitFixture);
    return Promise.resolve(
      validateOracleToolResult<Permit>("prism_v1_get_permit", result, "test"),
    );
  }

  getQuerySchema(): Promise<OracleResult<JsonObject>> {
    return Promise.resolve(
      validateOracleToolResult<JsonObject>(
        "prism_v1_get_query_schema",
        frozenResult<unknown>(querySchemaFixture),
        "test",
      ),
    );
  }
}
