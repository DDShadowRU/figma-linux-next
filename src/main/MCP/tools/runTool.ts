import type { CallToolResult } from "@modelcontextprotocol/server";
import { logger } from "Main/Logger";

/** Runs a tool body and shapes its output/failure the way MCP clients expect. */
export async function runTool<T extends Record<string, unknown>>(
  name: string,
  body: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    const output = await body();
    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[mcp] ${name} failed: ${message}`);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
