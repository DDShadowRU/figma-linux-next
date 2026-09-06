import type { SimplifiedDesign } from "figma-developer-mcp";
import { type SimplifiedNode, nodeType } from "./simplify";

// Figma names new layers after the tool that made them ("Frame 12"); such a
// name says nothing the node's type and id don't already say.
const AUTO_GENERATED_NAME =
  /^(?:Frame|Rectangle|Ellipse|Line|Vector|Group|Component|Instance|Polygon|Star|Text|Image|Slice|Section|Boolean|Union|Subtract|Intersect|Exclude|Arrow)\s+\d+$/;

const NODE_KEYS = new Set(["id", "name", "type", "template", "children"]);

const BARE_VALUE = /^[^\s"]*$/;
const BARE_KEY = /^[^\s":]*$/;

/**
 * Framelink's `tree` format: a header of shared tables, then one line per
 * node, `[TYPE] "name" #id key=value …`, indented two spaces per level. A node
 * in `cut` (children left out) ends with `children=…`.
 */
export function serializeTree(design: SimplifiedDesign, cut: Set<string>, note?: string): string {
  const sections = [`NAME: ${JSON.stringify(design.name)}`];
  const table = (title: string, entries: Record<string, unknown>) => {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    const lines = keys.map((key) => `  ${quote(key, BARE_KEY)}: ${JSON.stringify(entries[key])}`);
    sections.push([`${title}:`, ...lines].join("\n"));
  };
  table("GLOBAL_VARS", design.globalVars.styles);
  table("ELEMENTS", design.elements);
  table("COMPONENTS", withoutId(design.components));
  table("COMPONENT_SETS", withoutId(design.componentSets));

  const lines = ["NODES:"];
  const renderNode = (node: SimplifiedNode, depth: number) => {
    const type = nodeType(node, design.elements) ?? "NODE";
    const parts = [`[${type}]`];
    if (node.name !== undefined && type !== "TEXT" && !AUTO_GENERATED_NAME.test(node.name)) {
      parts.push(JSON.stringify(node.name));
    }
    parts.push(`#${node.id}`);
    if (node.template !== undefined) parts.push(`template=${node.template}`);
    for (const [key, value] of Object.entries(node)) {
      if (NODE_KEYS.has(key) || value === undefined) continue;
      const rendered =
        typeof value === "string" && key !== "text"
          ? quote(value, BARE_VALUE)
          : JSON.stringify(value);
      parts.push(`${key}=${rendered}`);
    }
    if (cut.has(node.id)) parts.push("children=…");
    lines.push("  ".repeat(depth) + parts.join(" "));
    for (const child of node.children ?? []) renderNode(child, depth + 1);
  };
  for (const node of design.nodes) renderNode(node, 0);
  sections.push(lines.join("\n"));

  if (note) sections.push(note);
  return sections.join("\n\n");
}

function quote(value: string, bare: RegExp): string {
  return bare.test(value) ? value : JSON.stringify(value);
}

function withoutId(entries: Record<string, { id: string }>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, { id: _id, ...rest }]) => [key, rest]),
  );
}
