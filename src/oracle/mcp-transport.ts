import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { OracleCallOptions, OracleMcpToolName, OracleMcpTransport } from "./types";

export const MAX_ORACLE_MCP_HTTP_RESPONSE_BYTES = 131_072;

export class OracleMcpTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OracleMcpTransportError";
  }
}

export class OracleMcpResponseSizeError extends OracleMcpTransportError {
  constructor(message: string) {
    super(message);
    this.name = "OracleMcpResponseSizeError";
  }
}

function responseTooLarge(maxBytes: number): OracleMcpResponseSizeError {
  return new OracleMcpResponseSizeError(
    `Oracle MCP HTTP response exceeded ${maxBytes} bytes before contract validation.`,
  );
}

export function createBoundedOracleFetch(
  baseFetch: FetchLike = globalThis.fetch,
  maxBytes = MAX_ORACLE_MCP_HTTP_RESPONSE_BYTES,
): FetchLike {
  return async (url, init) => {
    const response = await baseFetch(url, init);
    const contentLength = response.headers.get("content-length");
    if (/^\d+$/.test(contentLength ?? "") && Number(contentLength) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw responseTooLarge(maxBytes);
    }
    if (!response.body) return response;

    let receivedBytes = 0;
    const boundedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxBytes) {
            controller.error(responseTooLarge(maxBytes));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(boundedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export class StreamableHttpOracleMcpTransport implements OracleMcpTransport {
  constructor(
    private readonly endpoint: URL,
    private readonly boundedFetch: FetchLike = createBoundedOracleFetch(),
  ) {}

  async callTool(
    tool: OracleMcpToolName,
    input: Readonly<Record<string, unknown>>,
    options?: OracleCallOptions,
  ): Promise<unknown> {
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      fetch: this.boundedFetch,
    });
    const client = new Client({ name: "prism-roofing-crm", version: "0.1.0" });
    const closeOnAbort = () => {
      void client.close().catch(() => undefined);
    };
    options?.signal?.addEventListener("abort", closeOnAbort, { once: true });

    try {
      options?.signal?.throwIfAborted();
      // The SDK's concrete and interface declarations disagree only under
      // exactOptionalPropertyTypes; at runtime this is its documented transport pair.
      await client.connect(transport as unknown as Transport);
      const response = await client.callTool(
        { name: tool, arguments: { ...input } },
        undefined,
        {
          ...(options?.signal ? { signal: options.signal } : {}),
          ...(options?.timeoutMs
            ? {
                timeout: options.timeoutMs,
                maxTotalTimeout: options.timeoutMs,
              }
            : {}),
        },
      );
      if (
        "structuredContent" in response &&
        typeof response.structuredContent === "object" &&
        response.structuredContent !== null
      ) {
        return response.structuredContent;
      }

      if (!("content" in response) || !Array.isArray(response.content)) {
        throw new OracleMcpTransportError(
          `Oracle MCP tool ${tool} returned a task result instead of a completed response.`,
        );
      }
      const textBlocks = response.content.filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string",
      );
      const [textBlock] = textBlocks;
      if (textBlocks.length === 1 && textBlock) {
        try {
          return JSON.parse(textBlock.text) as unknown;
        } catch (error) {
          throw new OracleMcpTransportError(
            `Oracle MCP tool ${tool} returned non-JSON text content.`,
            { cause: error },
          );
        }
      }
      throw new OracleMcpTransportError(
        `Oracle MCP tool ${tool} did not return structured JSON content.`,
      );
    } catch (error) {
      if (error instanceof OracleMcpTransportError) {
        throw error;
      }
      throw new OracleMcpTransportError(`Oracle MCP call failed for ${tool}.`, {
        cause: error,
      });
    } finally {
      options?.signal?.removeEventListener("abort", closeOnAbort);
      await client.close().catch(() => undefined);
    }
  }
}
