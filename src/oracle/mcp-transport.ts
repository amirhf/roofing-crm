import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type {
  OracleCallOptions,
  OracleMcpToolDescriptor,
  OracleMcpToolName,
  OracleMcpTransport,
} from "./types";

export const MAX_ORACLE_MCP_HTTP_RESPONSE_BYTES = 131_072;
export const MAX_ORACLE_MCP_CLOSE_MS = 1_000;

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

function operationSignal(options?: OracleCallOptions): AbortSignal | undefined {
  const signals = [
    options?.signal,
    options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  ].filter((signal): signal is AbortSignal => signal !== undefined);
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Oracle MCP operation aborted.", "AbortError");
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export async function settleBoundedOracleClose(
  close: () => Promise<void>,
  operationSignal: AbortSignal | undefined,
  timeoutMs = MAX_ORACLE_MCP_CLOSE_MS,
): Promise<void> {
  const closeTimeout = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
  const signal = operationSignal
    ? AbortSignal.any([operationSignal, closeTimeout])
    : closeTimeout;
  try {
    await awaitWithSignal(Promise.resolve().then(close), signal);
  } catch {
    // Cleanup must never extend or replace the bounded operation result.
  }
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
    return this.withConnectedClient(
      `call failed for ${tool}`,
      options,
      async (client, effectiveOptions) => {
        const response = await client.callTool(
          { name: tool, arguments: { ...input } },
          undefined,
          this.requestOptions(effectiveOptions),
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
      },
    );
  }

  async listTools(
    options?: OracleCallOptions,
  ): Promise<readonly OracleMcpToolDescriptor[]> {
    return this.withConnectedClient(
      "tool discovery failed",
      options,
      async (client, effectiveOptions) => {
        const response = await client.listTools(
          undefined,
          this.requestOptions(effectiveOptions),
        );
        return response.tools.map((tool) => ({
          name: tool.name,
          inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
          outputSchema:
            tool.outputSchema && typeof tool.outputSchema === "object"
              ? (tool.outputSchema as Readonly<Record<string, unknown>>)
              : null,
        }));
      },
    );
  }

  async listToolNames(options?: OracleCallOptions): Promise<readonly string[]> {
    return (await this.listTools(options)).map((tool) => tool.name);
  }

  private requestOptions(options?: OracleCallOptions) {
    return {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs
        ? {
            timeout: options.timeoutMs,
            maxTotalTimeout: options.timeoutMs,
          }
        : {}),
    };
  }

  private async withConnectedClient<T>(
    operation: string,
    options: OracleCallOptions | undefined,
    execute: (client: Client, options: OracleCallOptions) => Promise<T>,
  ): Promise<T> {
    const deadlineAt = options?.timeoutMs ? performance.now() + options.timeoutMs : null;
    const signal = operationSignal(options);
    const effectiveOptions: OracleCallOptions = {
      ...(signal ? { signal } : {}),
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    };
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      fetch: this.boundedFetch,
    });
    const client = new Client({ name: "prism-roofing-crm", version: "0.1.0" });
    const closeOnAbort = () => {
      void client.close().catch(() => undefined);
    };
    signal?.addEventListener("abort", closeOnAbort, { once: true });

    try {
      signal?.throwIfAborted();
      // The SDK's concrete and interface declarations disagree only under
      // exactOptionalPropertyTypes; at runtime this is its documented transport pair.
      await awaitWithSignal(client.connect(transport as unknown as Transport), signal);
      return await awaitWithSignal(execute(client, effectiveOptions), signal);
    } catch (error) {
      if (error instanceof OracleMcpTransportError) {
        throw error;
      }
      throw new OracleMcpTransportError(`Oracle MCP ${operation}.`, {
        cause: error,
      });
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
      const remainingMs =
        deadlineAt === null
          ? MAX_ORACLE_MCP_CLOSE_MS
          : Math.max(
              1,
              Math.min(MAX_ORACLE_MCP_CLOSE_MS, deadlineAt - performance.now()),
            );
      await settleBoundedOracleClose(() => client.close(), signal, remainingMs);
    }
  }
}
