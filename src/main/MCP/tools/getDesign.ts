import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { DESIGN_MAX_DEPTH, DESIGN_MAX_OUTPUT_BYTES } from "../config";
import { cutNodeIds, simplifyDesign, tidyDesign } from "../design/simplify";
import { serializeTree } from "../design/serializeTree";
import { type DesignExport, exportDesign } from "../scripts/exportDesign";
import type { ToolContext } from "./context";
import { exportErrorMessage } from "./exportErrors";
import { runTool } from "./runTool";
import { fileKeySchema, nodeIdSchema, normalizeNodeId } from "./schemas";

const inputSchema = z.object({
  fileKey: fileKeySchema,
  nodeId: nodeIdSchema,
  depth: z
    .number()
    .int()
    .min(1)
    .max(DESIGN_MAX_DEPTH)
    .optional()
    .describe(
      "OPTIONAL. Do NOT use unless explicitly requested by the user. Levels below the node to include",
    ),
});

export function registerGetDesign(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_design",
    {
      title: "Get design",
      description:
        "Get one node of a Figma file as a compact text tree of layout, content, visuals and " +
        "component information",
      inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ fileKey, nodeId, depth }) =>
      runTool("get_design", async () => {
        const id = normalizeNodeId(nodeId);
        const session = await ctx.files.open(fileKey);
        const item = await exportDesign(session, id, depth);
        const error = exportErrorMessage(item, fileKey);
        if (error) throw new Error(error);
        const text = await renderWithinBudget(item, depth);
        return { content: [{ type: "text", text }] };
      }),
  );
}

/**
 * Renders the whole subtree, and when that exceeds the output limit binary
 * searches the deepest level that still fits (output size grows with depth).
 */
async function renderWithinBudget(item: DesignExport, requestedDepth?: number): Promise<string> {
  const rest = item.rest;
  if (!rest) throw new Error(`Node "${item.id}" returned no design data`);
  const parents = new Set(item.parents ?? []);
  const deepest = item.deepest ?? 0;

  const render = async (depth: number) => {
    const design = await simplifyDesign(rest, depth);
    tidyDesign(design);
    const cut = cutNodeIds(design, parents);
    const shown =
      requestedDepth === undefined
        ? `showing ${depth} of ${deepest} levels to fit the size limit`
        : `showing ${depth} level(s) as requested`;
    const note =
      cut.size === 0
        ? undefined
        : `TRUNCATED: ${shown}; the ${cut.size} nodes marked children=… have more inside, ` +
          "call get_design with their id to read them";
    return serializeTree(design, cut, note);
  };
  const fits = (text: string) => Buffer.byteLength(text, "utf8") <= DESIGN_MAX_OUTPUT_BYTES;

  const fullDepth = requestedDepth ?? deepest;
  const full = await render(fullDepth);
  if (fits(full) || fullDepth <= 1) return full;

  let lo = 1;
  let hi = fullDepth - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const text = await render(mid);
    if (fits(text)) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ?? render(1);
}
