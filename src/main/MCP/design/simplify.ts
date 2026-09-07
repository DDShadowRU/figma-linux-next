import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import { type SimplifiedDesign, allExtractors, simplifyRawFigmaObject } from "figma-developer-mcp";
import { rootLayoutExtractor } from "./rootLayout";
import { svgColorsHook } from "./svgColors";

export type SimplifiedNode = SimplifiedDesign["nodes"][number];

type Elements = SimplifiedDesign["elements"];

export const nodeBody = (node: SimplifiedNode, elements: Elements) =>
  node.template ? elements[node.template] : node;

export const nodeType = (node: SimplifiedNode, elements: Elements) =>
  nodeBody(node, elements)?.type;

function* eachNode(nodes: SimplifiedNode[]): Generator<SimplifiedNode> {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* eachNode(node.children);
  }
}

export function simplifyDesign(
  rest: GetFileNodesResponse,
  maxDepth?: number,
): Promise<SimplifiedDesign> {
  const { captureStyles, afterChildren } = svgColorsHook();

  return simplifyRawFigmaObject(rest, [...allExtractors, rootLayoutExtractor, captureStyles], {
    maxDepth,
    afterChildren,
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
  pruneComponents(design);
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

function pruneComponents(design: SimplifiedDesign): void {
  const used = new Set<string>();
  for (const node of eachNode(design.nodes)) {
    const componentId = nodeBody(node, design.elements)?.componentId;
    if (componentId) used.add(componentId);
  }

  const sets = new Set<string>();
  for (const [id, component] of Object.entries(design.components)) {
    if (!used.has(id)) delete design.components[id];
    else if (component.componentSetId) sets.add(component.componentSetId);
  }
  for (const id of Object.keys(design.componentSets)) {
    if (!sets.has(id)) delete design.componentSets[id];
  }
}

export interface DesignFlags {
  autoLineHeight: boolean;
  paints: boolean;
  svgColors: boolean;
}

export function designFlags(design: SimplifiedDesign): DesignFlags {
  const flags: DesignFlags = { autoLineHeight: false, paints: false, svgColors: false };

  for (const node of eachNode(design.nodes)) {
    const body = nodeBody(node, design.elements);
    if (!body) continue;

    const ref = body.textStyle;
    const style = typeof ref === "string" ? design.globalVars.styles[ref] : ref;
    if (style && typeof style === "object" && !("lineHeight" in style)) flags.autoLineHeight = true;

    if (body.fills !== undefined || body.strokes !== undefined) {
      flags.paints = true;
      if (body.type === "IMAGE-SVG") flags.svgColors = true;
    }
  }
  return flags;
}

/**
 * Simplified leaves that have children in Figma: the subtrees an agent has to
 * request separately. Collapsed vector containers (`IMAGE-SVG`) lose their
 * children on purpose and are not cut.
 */
export function cutNodeIds(design: SimplifiedDesign, parents: Set<string>): Set<string> {
  const cut = new Set<string>();
  for (const node of eachNode(design.nodes)) {
    if (node.children) continue;
    if (nodeType(node, design.elements) !== "IMAGE-SVG" && parents.has(node.id)) cut.add(node.id);
  }
  return cut;
}
