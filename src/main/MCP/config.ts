import { version as APP_VERSION } from "../../../package.json";

export const MCP_PORT = 3845;
export const MCP_HOST = "127.0.0.1";
export const MCP_PATH = "/mcp";
export const SERVER_NAME = "figma-linux-next";
export const SERVER_VERSION = APP_VERSION;

export const FILE_OPEN_TIMEOUT_MS = Number(process.env.FIGMA_MCP_FILE_OPEN_TIMEOUT_MS) || 60_000;
export const PLUGIN_API_POLL_MS = 500;
