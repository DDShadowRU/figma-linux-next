import type { McpAssetStore } from "../assets/McpAssetStore";
import type { AndroidStudio } from "../assets/vectorDrawable/androidStudio";
import type { McpFileRegistry } from "../files/McpFileRegistry";

export interface ToolContext {
  files: McpFileRegistry;
  assets: McpAssetStore;
  androidStudio: () => AndroidStudio | null;
}
