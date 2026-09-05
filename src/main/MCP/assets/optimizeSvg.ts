import { logger } from "Main/Logger";
import type { Config } from "svgo";

// Figma ids like clip0_14012_106227 are unique per node; minified ones collide as soon as
// several exported files are inlined into one page.
const SVGO_CONFIG: Config = {
  plugins: [{ name: "preset-default", params: { overrides: { cleanupIds: { minify: false } } } }],
};

// Loaded on the first svg export so css-tree is not parsed at app start-up.
let svgo: Promise<typeof import("svgo")> | null = null;

export async function optimizeSvg(svg: string): Promise<string> {
  try {
    svgo ??= import("svgo");
    const { optimize } = await svgo;
    return optimize(svg, SVGO_CONFIG).data;
  } catch (error) {
    logger.warn("[mcp] svgo failed, writing the raw export:", error);
    return svg;
  }
}
