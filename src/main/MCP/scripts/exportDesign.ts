import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import { DESIGN_RAW_MAX_BYTES } from "../config";
import type { McpFileSession } from "../files/McpFileSession";

export type DesignExportError =
  | "not_found"
  | "not_exportable"
  | "hidden"
  | "raw_too_large"
  | "export_failed";

export interface DesignExport {
  id: string;
  name?: string;
  type?: string;
  error?: DesignExportError;
  message?: string;
  bytes?: number;
  rest?: GetFileNodesResponse;
  parents?: string[];
  deepest?: number;
}

export async function exportDesign(
  session: McpFileSession,
  id: string,
  depth?: number,
): Promise<DesignExport> {
  const { design } = await session.execJson<{ design: DesignExport }>(
    buildExportDesignScript(id, depth),
  );
  return design;
}

// The node's own errors stay nested under `design`: a top-level `error` is
// how execJson recognises a Plugin API failure.
export const buildExportDesignScript = (id: string, depth?: number) => `(async () => {
  try {
    const figma = window.figma;
    if (!figma || !figma.root) return JSON.stringify({ error: "Figma Plugin API is not available" });
    const id = ${JSON.stringify(id)};
    const maxDepth = ${depth ?? "Infinity"};
    const rawMaxBytes = ${DESIGN_RAW_MAX_BYTES};
    const item = { id };
    const reply = (design) => JSON.stringify({ design });
    try {
      const node = await figma.getNodeByIdAsync(id);
      if (!node) return reply({ ...item, error: "not_found" });
      item.name = node.name;
      item.type = node.type;
      if (typeof node.exportAsync !== "function") return reply({ ...item, error: "not_exportable" });
      if (node.visible === false) return reply({ ...item, error: "hidden" });
      // JSON_REST_V1 exports a node on a page that isn't loaded yet with no
      // children at all, so load the node's page first (the node may be a page).
      let page = node;
      while (page && page.type !== "PAGE" && page.type !== "DOCUMENT") page = page.parent;
      if (page && page.type === "PAGE" && typeof page.loadAsync === "function") {
        await page.loadAsync();
      }
      const raw = await node.exportAsync({ format: "JSON_REST_V1" });

      // Same depth semantics as the simplifier: the requested node is depth 0
      // and a node at depth >= maxDepth keeps no children. The array stays
      // (empty): the simplifier reads children.length on auto-layout frames.
      const parents = [];
      let deepest = 0;
      const walk = (n, d) => {
        if (d > deepest) deepest = d;
        if (!Array.isArray(n.children)) return;
        if (n.children.some((child) => child.visible !== false)) parents.push(n.id);
        if (d >= maxDepth) {
          n.children = [];
          return;
        }
        for (const child of n.children) walk(child, d + 1);
      };
      walk(raw.document, 0);

      const rest = {
        name: figma.root.name,
        nodes: {
          [id]: {
            document: raw.document,
            components: raw.components || {},
            componentSets: raw.componentSets || {},
            styles: raw.styles || {},
          },
        },
      };
      const text = reply({ ...item, rest, parents, deepest });
      if (text.length > rawMaxBytes) {
        return reply({ ...item, error: "raw_too_large", bytes: text.length });
      }
      return text;
    } catch (e) {
      return reply({ ...item, error: "export_failed", message: String((e && e.message) || e) });
    }
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;
