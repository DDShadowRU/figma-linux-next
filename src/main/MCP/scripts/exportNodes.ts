import { EXPORT_BUDGET } from "../config";
import type { McpFileSession } from "../files/McpFileSession";
import { EXPORT_DEADLINE_JS } from "./index";

export interface ExportConstraint {
  type: "SCALE" | "WIDTH" | "HEIGHT";
  value: number;
}

// `fit` is resolved inside the tab: only there is the node's size known.
export type ExportSpec =
  | { format: "PNG" | "JPG"; constraint: ExportConstraint }
  | { format: "PNG"; fit: { scale: number; maxEdge: number } }
  | { format: "SVG_STRING" };

export interface ExportRequest {
  id: string;
  spec: ExportSpec;
}

export type ExportNodeError =
  | "not_found"
  | "not_exportable"
  | "hidden"
  | "no_size"
  | "export_failed"
  | "export_stalled"
  | "skipped";

/** Either `error` is set, or name/type/width/height plus one of data/svg are. */
export interface ExportedNode {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  data?: string;
  svg?: string;
  error?: ExportNodeError;
  message?: string;
}

export async function exportNodes(
  session: McpFileSession,
  requests: ExportRequest[],
): Promise<ExportedNode[]> {
  const script = buildExportNodesScript(requests);
  const { items } = await session.execJson<{ items: ExportedNode[] }>(script);
  return items;
}

export const buildExportNodesScript = (requests: ExportRequest[]) => `(async () => {
  try {
    const figma = window.figma;
    if (!figma || !figma.root) return JSON.stringify({ error: "Figma Plugin API is not available" });
    const requests = ${JSON.stringify(requests)};
    const budget = ${JSON.stringify(EXPORT_BUDGET)};
    const started = performance.now();
${EXPORT_DEADLINE_JS}
    let bytesTotal = 0;
    const items = [];

    // A page has no size of its own; exportAsync renders the union of its children.
    const measure = async (node) => {
      if (node.type !== "PAGE") {
        return typeof node.width === "number" && typeof node.height === "number"
          ? { width: node.width, height: node.height }
          : null;
      }
      if (typeof node.loadAsync === "function") await node.loadAsync();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const child of node.children) {
        const box = child.absoluteBoundingBox;
        if (!box) continue;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      }
      return maxX > -Infinity ? { width: maxX - minX, height: maxY - minY } : null;
    };

    const fitConstraint = (size, fit) => {
      const longest = Math.max(size.width, size.height);
      const edge = size.width >= size.height ? "WIDTH" : "HEIGHT";
      if (longest * fit.scale > fit.maxEdge) return { type: edge, value: fit.maxEdge };
      return { type: "SCALE", value: fit.scale };
    };

    for (const request of requests) {
      const item = { id: request.id };
      items.push(item);
      if (performance.now() - started > budget.timeMs || bytesTotal > budget.bytes) {
        item.error = "skipped";
        continue;
      }
      try {
        const node = await figma.getNodeByIdAsync(request.id);
        if (!node) {
          item.error = "not_found";
          continue;
        }
        item.name = node.name;
        item.type = node.type;
        if (typeof node.exportAsync !== "function") {
          item.error = "not_exportable";
          continue;
        }
        if (node.visible === false) {
          item.error = "hidden";
          continue;
        }
        const size = await withDeadline(measure(node));
        if (!size || Math.max(size.width, size.height) <= 0) {
          item.error = "no_size";
          continue;
        }
        item.width = size.width;
        item.height = size.height;
        const settings = request.spec.fit
          ? { format: "PNG", constraint: fitConstraint(size, request.spec.fit) }
          : request.spec;
        const result = await withDeadline(node.exportAsync(settings));
        if (typeof result === "string") item.svg = result;
        else item.data = figma.base64Encode(result);
        bytesTotal += result.length;
      } catch (e) {
        if (e === stalled) {
          item.error = "export_stalled";
          continue;
        }
        item.error = "export_failed";
        item.message = String((e && e.message) || e);
      }
    }
    return JSON.stringify({ items });
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;
