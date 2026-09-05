import type { ContentBlock, McpServer } from "@modelcontextprotocol/server";
import { nativeImage } from "electron";
import * as z from "zod/v4";
import { ASSET_FORMATS, assetFormatSchema } from "../assets/formats";
import { MAX_ASSET_NODES } from "../config";
import { exportNodes } from "../scripts/exportNodes";
import type { ToolContext } from "./context";
import { exportErrorMessage } from "./exportErrors";
import { runTool } from "./runTool";
import { assetScaleSchema, fileKeySchema, nodeIdSchema, normalizeNodeId } from "./schemas";

const MAX_SLUG_LENGTH = 64;

function slugify(name: string, fallbackId: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug || `node-${fallbackId.replace(/:/g, "-").replace(/;/g, "_")}`;
}

function reserveFileName(base: string, ext: string, taken: Set<string>): string {
  let candidate = `${base}.${ext}`;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}.${ext}`;
  taken.add(candidate);
  return candidate;
}

const inputSchema = z.object({
  fileKey: fileKeySchema,
  nodes: z
    .array(nodeIdSchema)
    .min(1)
    .max(MAX_ASSET_NODES)
    .describe(`Node ids to export, up to ${MAX_ASSET_NODES} per call`),
  format: assetFormatSchema.default("png"),
  scale: assetScaleSchema.default(1),
});

const sizeSchema = z.number().describe("Image px for png/jpg, design px for svg");

const outputSchema = z.object({
  files: z.array(
    z.object({
      nodeId: z.string(),
      name: z.string(),
      path: z.string(),
      width: sizeSchema,
      height: sizeSchema,
    }),
  ),
  failed: z.array(z.object({ nodeId: z.string(), error: z.string() })),
});

export function registerDownloadAssets(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "download_assets",
    {
      title: "Download assets",
      description:
        "Exports nodes of a Figma file as png, jpg or svg files and returns their paths. " +
        "The files are temporary and are deleted when the app restarts: copy the ones you need. " +
        `Up to ${MAX_ASSET_NODES} nodes per call; a node that fails is listed in "failed" while ` +
        "the others are still exported.",
      inputSchema,
      outputSchema,
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ fileKey, nodes, format, scale }) =>
      runTool("download_assets", async () => {
        const spec = ASSET_FORMATS[format];
        const session = await ctx.files.open(fileKey);
        const items = await exportNodes(
          session,
          nodes.map((nodeId) => ({ id: normalizeNodeId(nodeId), spec: spec.settings(scale) })),
        );

        let dir: string | null = null;
        const taken = new Set<string>();
        const files: z.infer<typeof outputSchema>["files"] = [];
        const failed: z.infer<typeof outputSchema>["failed"] = [];
        const content: ContentBlock[] = [];

        for (const [index, item] of items.entries()) {
          const error = exportErrorMessage(item, fileKey, nodes[index]);
          if (error) {
            failed.push({ nodeId: item.id, error });
            continue;
          }

          const fileName = reserveFileName(slugify(item.name, item.id), format, taken);
          const payload = item.svg ?? Buffer.from(item.data, "base64");
          dir ??= await ctx.assets.createCallDir();
          const written = await ctx.assets.write(dir, fileName, payload);
          const size =
            typeof payload === "string"
              ? { width: Math.round(item.width), height: Math.round(item.height) }
              : nativeImage.createFromBuffer(payload).getSize();

          files.push({ nodeId: item.id, name: item.name, path: written.path, ...size });
          content.push({
            type: "resource_link",
            uri: written.uri,
            name: fileName,
            mimeType: spec.mimeType,
            size: written.bytes,
          });
        }

        if (files.length === 0) {
          throw new Error(`No files were exported:\n${failed.map((f) => f.error).join("\n")}`);
        }
        return { output: { files, failed }, content };
      }),
  );
}
