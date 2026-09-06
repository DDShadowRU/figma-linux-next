import type { ContentBlock, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { sniffImageType } from "../assets/imageTypes";
import { resourceLink } from "../assets/McpAssetStore";
import { MAX_ASSET_NODES } from "../config";
import { exportImageFills, type ImageFill, type ImageFillsNode } from "../scripts/exportImageFills";
import type { ToolContext } from "./context";
import { exportErrorMessage, type FillProblem, imageFillErrorMessage } from "./exportErrors";
import { reserveBaseName, slugify } from "./fileNames";
import { runTool } from "./runTool";
import { fileKeySchema, nodeIdSchema, normalizeNodeId } from "./schemas";

const inputSchema = z.object({
  fileKey: fileKeySchema,
  nodes: z
    .array(nodeIdSchema)
    .min(1)
    .max(MAX_ASSET_NODES)
    .describe(`Node ids whose image fills to download, up to ${MAX_ASSET_NODES} per call`),
});

const outputSchema = z.object({
  images: z.array(
    z.object({
      nodeId: z.string(),
      name: z.string().describe("Layer name of the node the fill is on"),
      imageRef: z.string().describe("The fill id, the same one get_design prints"),
      path: z.string(),
      width: z.number().describe("Pixel width of the file, before any cropping"),
      height: z.number().describe("Pixel height of the file, before any cropping"),
      imageTransform: z
        .array(z.array(z.number()))
        .optional()
        .describe(
          "Present when the fill is cropped; the file is not. Crop it at left=t[0][2]*width, " +
            "top=t[1][2]*height, w=t[0][0]*width, h=t[1][1]*height",
        ),
    }),
  ),
  failed: z.array(z.object({ nodeId: z.string(), error: z.string() })),
});

interface Written {
  path: string;
  width: number;
  height: number;
}

export function registerDownloadImageFills(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "download_image_fills",
    {
      title: "Download image fills",
      description:
        "Downloads the original png, jpg or webp behind the IMAGE fills of nodes in a Figma file " +
        "and returns their paths. The files are temporary and are deleted when the mcp restarts: " +
        "copy the ones you need",
      inputSchema,
      outputSchema,
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    ({ fileKey, nodes }) =>
      runTool("download_image_fills", async () => {
        const { items, sources } = await ctx.files.withFile(fileKey, (session) =>
          exportImageFills(session, nodes.map(normalizeNodeId)),
        );

        const failed: z.infer<typeof outputSchema>["failed"] = [];
        const wanted: { item: ImageFillsNode; fill: ImageFill }[] = [];
        for (const item of items) {
          const error = exportErrorMessage(item, fileKey);
          if (error) {
            failed.push({ nodeId: item.id, error });
            continue;
          }
          for (const fill of item.fills ?? []) wanted.push({ item, fill });
        }

        const written = new Map<string, Written>();
        const problems = new Map<string, FillProblem>();
        const content: ContentBlock[] = [];
        const taken = new Set<string>();
        let dir: string | null = null;
        for (const { item, fill } of wanted) {
          if (written.has(fill.imageRef) || problems.has(fill.imageRef)) continue;
          const source = sources[fill.imageRef];
          if (source === undefined) {
            problems.set(fill.imageRef, { error: "image_missing" });
            continue;
          }
          if ("error" in source) {
            problems.set(fill.imageRef, source);
            continue;
          }
          const data = Buffer.from(source.data, "base64");
          const type = sniffImageType(data);
          if (!type) {
            problems.set(fill.imageRef, { error: "unsupported_format" });
            continue;
          }
          dir ??= await ctx.assets.createCallDir();
          const base = reserveBaseName(slugify(item.name ?? "", item.id), "-", taken);
          const fileName = `${base}.${type.extension}`;
          const asset = await ctx.assets.write(dir, fileName, data);
          written.set(fill.imageRef, {
            path: asset.path,
            width: source.width,
            height: source.height,
          });
          content.push(resourceLink(asset, fileName, type.mimeType));
        }

        const images: z.infer<typeof outputSchema>["images"] = [];
        for (const { item, fill } of wanted) {
          const hit = written.get(fill.imageRef);
          if (!hit) {
            const problem = problems.get(fill.imageRef) ?? { error: "image_missing" };
            failed.push({
              nodeId: item.id,
              error: imageFillErrorMessage(problem, fill.imageRef, item),
            });
            continue;
          }
          images.push({
            nodeId: item.id,
            name: item.name ?? "",
            imageRef: fill.imageRef,
            path: hit.path,
            width: hit.width,
            height: hit.height,
            imageTransform: fill.imageTransform,
          });
        }

        if (images.length === 0) {
          throw new Error(
            `No image fills were downloaded:\n${failed.map((f) => f.error).join("\n")}`,
          );
        }
        return { output: { images, failed }, content };
      }),
  );
}
