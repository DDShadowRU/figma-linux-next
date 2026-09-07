import type { ExtractorFn, StyleTypes } from "figma-developer-mcp";

type SimplifiedLayout = Extract<StyleTypes, { mode: unknown }>;

/**
 * Framelink leaves the parentless node without `dimensions` and renames its
 * fixed axis `contextual` + `designed*`; with no parent, the bounding box is
 * the only size there is. Assigned inline rather than under a new `globalVars`
 * key — that table is the package's namespace and dedup memo — and cloned
 * because the entry read is shared.
 */
export const rootLayoutExtractor: ExtractorFn = (raw, node, ctx) => {
  if (ctx.parent !== undefined) return;
  const box = "absoluteBoundingBox" in raw ? raw.absoluteBoundingBox : undefined;
  if (!box || typeof node.layout !== "string") return;

  const layout = structuredClone(ctx.globalVars.styles[node.layout] as SimplifiedLayout);
  if (layout.sizing?.horizontal === "contextual") layout.sizing.horizontal = "fixed";
  if (layout.sizing?.vertical === "contextual") layout.sizing.vertical = "fixed";
  delete layout.designedWidth;
  delete layout.designedHeight;
  layout.dimensions = { width: round(box.width), height: round(box.height) };

  node.layout = layout;
};

const round = (value: number) => Number(value.toFixed(2));
