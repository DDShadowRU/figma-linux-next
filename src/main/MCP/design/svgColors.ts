import type { ExtractorFn, GlobalVars, TraversalOptions } from "figma-developer-mcp";
import { collapseSvgContainers } from "figma-developer-mcp";
import { SVG_COLORS_MAX } from "../config";
import type { SimplifiedNode } from "./simplify";

type Paints = Exclude<NonNullable<SimplifiedNode["fills"]>, string>;

const PAINT_FIELDS = ["fills", "strokes"] as const;

const MORE_COLORS = "…" as Paints[number];

const isBooleanOp = (node: { type?: string }) => node.type === "BOOLEAN_OPERATION";

export function svgColorsHook(): {
  captureStyles: ExtractorFn;
  afterChildren: NonNullable<TraversalOptions["afterChildren"]>;
} {
  let styles: GlobalVars["styles"] = {};

  return {
    captureStyles: (_raw, _node, ctx) => {
      styles = ctx.globalVars.styles;
    },
    afterChildren: (raw, node, children) => {
      const kept = collapseSvgContainers(raw, node, children);
      if (kept.length === 0 && !isBooleanOp(raw)) keepSvgColors(node, children, styles);
      return kept;
    },
  };
}

function keepSvgColors(
  node: SimplifiedNode,
  children: SimplifiedNode[],
  styles: GlobalVars["styles"],
): void {
  for (const field of PAINT_FIELDS) {
    const sources: (string | Paints)[] = [];
    const push = (value: SimplifiedNode["fills"]) => {
      if (value !== undefined && !sources.includes(value)) sources.push(value);
    };
    const walk = (child: SimplifiedNode) => {
      push(child[field]);
      if (isBooleanOp(child)) return;
      for (const nested of child.children ?? []) walk(nested);
    };
    push(node[field]);
    for (const child of children) walk(child);

    const paints: Paints = [];
    const seen = new Set<string>();
    let more = false;
    for (const source of sources) {
      const list = typeof source === "string" ? ((styles[source] as Paints) ?? []) : source;
      for (const paint of list) {
        if (paint === MORE_COLORS) {
          more = true;
          continue;
        }
        const key = JSON.stringify(paint);
        if (seen.has(key)) continue;
        seen.add(key);
        paints.push(paint);
      }
    }
    if (paints.length === 0) continue;

    const merged = JSON.stringify(paints);
    const token = sources.find(
      (s) => typeof s === "string" && JSON.stringify(styles[s]) === merged,
    );
    if (!more && typeof token === "string") {
      node[field] = token;
      continue;
    }
    const kept = paints.slice(0, SVG_COLORS_MAX);
    if (more || paints.length > SVG_COLORS_MAX) kept.push(MORE_COLORS);
    node[field] = kept;
  }
}
