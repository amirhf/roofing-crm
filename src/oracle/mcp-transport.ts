import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { OracleMcpToolName, OracleMcpTransport } from "./types";

export class OracleMcpTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OracleMcpTransportError";
  }
}

export class StreamableHttpOracleMcpTransport implements OracleMcpTransport {
  constructor(private readonly endpoint: URL) {}

  async callTool(
    tool: OracleMcpToolName,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const transport = new StreamableHTTPClientTransport(this.endpoint);
    const client = new Client({ name: "prism-roofing-crm", version: "0.1.0" });

    try {
      // The SDK's concrete and interface declarations disagree only under
      // exactOptionalPropertyTypes; at runtime this is its documented transport pair.
      await client.connect(transport as unknown as Transport);
      const response = await client.callTool({ name: tool, arguments: { ...input } });
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
      await client.close().catch(() => undefined);
    }
  }
}
