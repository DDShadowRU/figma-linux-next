import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "./context";
import { registerGetFileName } from "./getFileName";

export type { ToolContext } from "./context";

export function registerTools(server: McpServer, ctx: ToolContext) {
  registerGetFileName(server, ctx);
}
