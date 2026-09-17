import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/server";
import { logger } from "Main/Logger";
import { McpFileError } from "../errors";

export interface ToolResult<T extends Record<string, unknown>> {
  output?: T;
  content?: ContentBlock[];
}

export interface ToolCall {
  tool: string;
  fileKey: string;
  detail: string;
}

/** Runs a tool body, logs the call and shapes its output/failure the way MCP clients expect. */
export async function runTool<T extends Record<string, unknown>>(
  call: ToolCall,
  body: () => Promise<ToolResult<T>>,
): Promise<CallToolResult> {
  const started = Date.now();
  const head = `[mcp] ${call.tool} ${call.fileKey} ${call.detail}`;
  logger.info(`${head} start`);
  try {
    const { output, content = [] } = await body();
    logger.info(`${head} ${Date.now() - started}ms ok`);
    if (output === undefined) return { content };
    return {
      content: [...content, { type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof McpFileError ? error.code : "error";
    logger.warn(`${head} ${Date.now() - started}ms ${code}: ${message}`);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
