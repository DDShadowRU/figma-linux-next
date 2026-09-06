import { version as APP_VERSION } from "../../../package.json";

export const MCP_PORT = 3845;
export const MCP_HOST = "127.0.0.1";
export const MCP_PATH = "/mcp";
export const SERVER_NAME = "figma-linux-next";
export const SERVER_VERSION = APP_VERSION;

export const FILE_OPEN_TIMEOUT_MS = Number(process.env.FIGMA_MCP_FILE_OPEN_TIMEOUT_MS) || 120_000;
export const PLUGIN_API_POLL_MS = 500;
export const MCP_TAB_IDLE_TTL_MS = Number(process.env.FIGMA_MCP_TAB_IDLE_TTL_MS) || 15 * 60 * 1000;

export const SCREENSHOT_MIN_EDGE = 512;
export const SCREENSHOT_MAX_EDGE = 2000;
export const SCREENSHOT_MAX_BYTES = 4.5 * 1024 * 1024;
export const MAX_ASSET_NODES = 20;
export const ASSET_MIN_SCALE = 0.1;
export const ASSET_MAX_SCALE = 4;
export const EXPORT_BUDGET = { timeMs: 45_000, bytes: 64 * 1024 * 1024 };
export const DESIGN_RAW_MAX_BYTES =
  Number(process.env.FIGMA_MCP_DESIGN_RAW_MAX_BYTES) || 48 * 1024 * 1024;
export const DESIGN_MAX_OUTPUT_BYTES =
  Number(process.env.FIGMA_MCP_DESIGN_MAX_OUTPUT_BYTES) || 64 * 1024;
export const DESIGN_MAX_DEPTH = 50;
export const ASSET_DIR_NAME = "figma-mcp-assets";
