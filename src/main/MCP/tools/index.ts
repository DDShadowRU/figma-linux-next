import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "./context";
import { registerDownloadAssets } from "./downloadAssets";
import { registerGetFileName } from "./getFileName";
import { registerGetScreenshot } from "./getScreenshot";

export type { ToolContext } from "./context";

export function registerTools(server: McpServer, ctx: ToolContext) {
  registerGetFileName(server, ctx);
  registerGetScreenshot(server, ctx);
  registerDownloadAssets(server, ctx);
}
