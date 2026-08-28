import type { SearchArguments, SearchResultData } from "@/oracle/types";

export interface NaturalLanguageQueryRequest {
  readonly query: string;
  readonly searchContext: Pick<
    SearchArguments,
    "county" | "center" | "radius" | "filters"
  >;
}

export type NaturalLanguageQueryResult =
  | Readonly<{
      status: "not_configured";
      message: string;
    }>
  | Readonly<{
      status: "complete";
      groundedSearch: SearchArguments;
      result: SearchResultData;
    }>;
