import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import {
  type SimplifiedDesign,
  allExtractors,
  collapseSvgContainers,
  simplifyRawFigmaObject,
} from "figma-developer-mcp";

export type SimplifiedNode = SimplifiedDesign["nodes"][number];

export const nodeType = (node: SimplifiedNode, elements: SimplifiedDesign["elements"]) =>
  node.type ?? (node.template ? elements[node.template]?.type : undefined);

export function simplifyDesign(
  rest: GetFileNodesResponse,
  maxDepth?: number,
): Promise<SimplifiedDesign> {
  return simplifyRawFigmaObject(rest, allExtractors, {
    maxDepth,
    afterChildren: collapseSvgContainers,
  });
}

const IMAGE_DOWNLOAD_KEYS = ["gifRef", "imageDownloadArguments"];

const STYLE_REF_FIELDS = ["layout", "fills", "strokes", "effects", "textStyle"] as const;

/**
 * Drops what the agent can't use: image download hints, empty values such as
 * `fills: []` (all paints hidden) or `sizing: {}`, styles that became empty and
 * the references to them, plus the float noise Figma leaves in opacity.
 */
export function tidyDesign(design: SimplifiedDesign): void {
  const emptyStyles = new Set<string>();
  for (const [key, value] of Object.entries(design.globalVars.styles)) {
    if (prune(value, emptyStyles) === undefined) {
      emptyStyles.add(key);
      delete design.globalVars.styles[key];
    }
  }
  prune(design.elements, emptyStyles);
  design.nodes = (prune(design.nodes, emptyStyles) ?? []) as SimplifiedNode[];
}

function prune(value: unknown, emptyStyles: Set<string>): unknown {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => prune(entry, emptyStyles)).filter((e) => e !== undefined);
    return entries.length ? entries : undefined;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.type === "IMAGE" && "scaleMode" in record) {
    for (const key of IMAGE_DOWNLOAD_KEYS) delete record[key];
  }
  if (typeof record.opacity === "number") record.opacity = Math.round(record.opacity * 1000) / 1000;
  for (const field of STYLE_REF_FIELDS) {
    const ref = record[field];
    if (typeof ref === "string" && emptyStyles.has(ref)) delete record[field];
  }
  for (const [key, entry] of Object.entries(record)) {
    const pruned = prune(entry, emptyStyles);
    if (pruned === undefined) delete record[key];
    else record[key] = pruned;
  }
  return Object.keys(record).length ? record : undefined;
}

/**
 * Simplified leaves that have children in Figma: the subtrees an agent has to
 * request separately. Collapsed vector containers (`IMAGE-SVG`) lose their
 * children on purpose and are not cut.
 */
export function cutNodeIds(design: SimplifiedDesign, parents: Set<string>): Set<string> {
  const cut = new Set<string>();
  const walk = (node: SimplifiedNode) => {
    if (node.children) {
      for (const child of node.children) walk(child);
      return;
    }
    if (nodeType(node, design.elements) !== "IMAGE-SVG" && parents.has(node.id)) cut.add(node.id);
  };
  for (const node of design.nodes) walk(node);
  return cut;
}
