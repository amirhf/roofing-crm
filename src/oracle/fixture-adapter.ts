import { ProductionFixtureSelectionError } from "../config/oracle";

import errorFixture from "../../contracts/fixtures/error-response.json";
import permitFixture from "../../contracts/fixtures/permit-response.json";
import propertyFixture from "../../contracts/fixtures/property-response.json";
import searchFixture from "../../contracts/fixtures/search-response.json";
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
  OracleResult,
  Permit,
  Property,
  SearchArguments,
  SearchResultData,
} from "./types";

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
    [errorFixture, permitFixture, propertyFixture, searchFixture].forEach((fixture) =>
      assertValidMcpFixture(fixture),
    );
  }

  getServiceInfo(): Promise<OracleResult<JsonObject>> {
    return Promise.reject(new FixtureCoverageError("prism_v1_get_service_info"));
  }

  getPipelineRunSummary(): Promise<OracleResult<JsonObject>> {
    return Promise.reject(new FixtureCoverageError("prism_v1_get_pipeline_run_summary"));
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
    return Promise.reject(new FixtureCoverageError("prism_v1_get_query_schema"));
  }
}
