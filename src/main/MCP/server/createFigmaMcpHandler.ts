import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import { logger } from "Main/Logger";
import { SERVER_NAME, SERVER_VERSION } from "../config";
import { registerAssetResource } from "../assets/registerAssetResource";
import { registerTools, type ToolContext } from "../tools";

/** Stateless: a fresh McpServer per request; everything that persists lives in ctx. */
export function createFigmaMcpHandler(ctx: ToolContext): McpHttpHandler {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
      registerTools(server, ctx);
      registerAssetResource(server, ctx.assets);
      return server;
    },
    { onerror: (error) => logger.warn(`[mcp] ${error.message}`) },
  );
}
