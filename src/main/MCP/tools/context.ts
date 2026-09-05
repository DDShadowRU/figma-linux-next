import type { McpAssetStore } from "../assets/McpAssetStore";
import type { McpFileRegistry } from "../files/McpFileRegistry";

export interface ToolContext {
  files: McpFileRegistry;
  assets: McpAssetStore;
}
