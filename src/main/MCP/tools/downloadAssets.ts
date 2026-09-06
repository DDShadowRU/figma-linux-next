import type { ContentBlock, McpServer } from "@modelcontextprotocol/server";
import { nativeImage } from "electron";
import * as z from "zod/v4";
import { ASSET_FORMATS, availableFormats, VECTOR_DRAWABLE } from "../assets/formats";
import { optimizeSvg } from "../assets/optimizeSvg";
import type { AndroidStudio } from "../assets/vectorDrawable/androidStudio";
import {
  convertSvgToVectorDrawable,
  type VectorDrawableResult,
} from "../assets/vectorDrawable/convertSvgToVectorDrawable";
import { MAX_ASSET_NODES } from "../config";
import { type ExportedNode, exportNodes } from "../scripts/exportNodes";
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

// Android resource names allow only [a-z0-9_] and must start with a letter.
function androidResourceName(name: string, fallbackId: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/, "");
  if (/^[a-z]/.test(slug)) return slug;
  return `node_${slug || fallbackId.replace(/[:;]/g, "_")}`;
}

function reserveBaseName(base: string, separator: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}${separator}${n}`;
  taken.add(candidate);
  return candidate;
}

interface Exported {
  item: ExportedNode;
  base: string;
}

type Payload = { data: string | Buffer; warning?: string } | { error: string };

async function payloadOf(
  item: ExportedNode,
  base: string,
  drawables: Map<string, VectorDrawableResult> | null,
): Promise<Payload> {
  if (!drawables) {
    return {
      data: item.svg !== undefined ? await optimizeSvg(item.svg) : Buffer.from(item.data, "base64"),
    };
  }
  const result = drawables.get(base);
  if (!result) return { error: "the converter produced no output" };
  return "error" in result ? result : { data: result.xml, warning: result.warning };
}

async function convertDrawables(
  ctx: ToolContext,
  studio: AndroidStudio,
  dir: string,
  exported: Exported[],
): Promise<Map<string, VectorDrawableResult>> {
  for (const { item, base } of exported) {
    await ctx.assets.write(dir, `${base}.svg`, item.svg ?? "");
  }

  return convertSvgToVectorDrawable(
    studio,
    dir,
    exported.map(({ base }) => base),
  );
}

const sizeSchema = z
  .number()
  .describe("Image px for png/jpg, design px (dp) for svg and vector-drawable");

const outputSchema = z.object({
  files: z.array(
    z.object({
      nodeId: z.string(),
      name: z.string(),
      path: z.string(),
      width: sizeSchema,
      height: sizeSchema,
      warning: z
        .string()
        .optional()
        .describe("vector-drawable only: what the converter dropped or approximated"),
    }),
  ),
  failed: z.array(z.object({ nodeId: z.string(), error: z.string() })),
});

function describeTool(vectorDrawable: boolean): string {
  const formats = vectorDrawable
    ? "png, jpg, svg or Android VectorDrawable xml"
    : "png, jpg or svg";
  return (
    `Exports nodes of a Figma file as ${formats} files and returns their paths. ` +
    "The files are temporary and are deleted when the mcp restarts: copy the ones you need"
  );
}

export function registerDownloadAssets(server: McpServer, ctx: ToolContext) {
  const studio = ctx.androidStudio();
  const inputSchema = z.object({
    fileKey: fileKeySchema,
    nodes: z
      .array(nodeIdSchema)
      .min(1)
      .max(MAX_ASSET_NODES)
      .describe(`Node ids to export, up to ${MAX_ASSET_NODES} per call`),
    format: z.enum(availableFormats(studio !== null)).default("png"),
    scale: assetScaleSchema.default(1),
  });

  server.registerTool(
    "download_assets",
    {
      title: "Download assets",
      description: describeTool(studio !== null),
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
          nodes.map((nodeId) => ({
            id: normalizeNodeId(nodeId),
            spec: spec.settings(scale),
          })),
        );

        const taken = new Set<string>();
        const exported: Exported[] = [];
        const failed: z.infer<typeof outputSchema>["failed"] = [];
        for (const item of items) {
          const error = exportErrorMessage(item, fileKey);
          if (error) {
            failed.push({ nodeId: item.id, error });
            continue;
          }
          const base =
            format === VECTOR_DRAWABLE
              ? reserveBaseName(androidResourceName(item.name, item.id), "_", taken)
              : reserveBaseName(slugify(item.name, item.id), "-", taken);
          exported.push({ item, base });
        }

        const files: z.infer<typeof outputSchema>["files"] = [];
        const content: ContentBlock[] = [];
        if (exported.length > 0) {
          const dir = await ctx.assets.createCallDir();
          const drawables =
            format === VECTOR_DRAWABLE && studio
              ? await convertDrawables(ctx, studio, dir, exported)
              : null;

          for (const { item, base } of exported) {
            const payload = await payloadOf(item, base, drawables);
            if ("error" in payload) {
              failed.push({
                nodeId: item.id,
                error: `VectorDrawable conversion of node "${item.id}" ("${item.name}") failed: ${payload.error}`,
              });
              continue;
            }
            const fileName = `${base}.${spec.extension}`;
            const written = await ctx.assets.write(dir, fileName, payload.data);
            const size =
              typeof payload.data === "string"
                ? {
                    width: Math.round(item.width),
                    height: Math.round(item.height),
                  }
                : nativeImage.createFromBuffer(payload.data).getSize();

            files.push({
              nodeId: item.id,
              name: item.name,
              path: written.path,
              ...size,
              warning: payload.warning,
            });
            content.push({
              type: "resource_link",
              uri: written.uri,
              name: fileName,
              mimeType: spec.mimeType,
              size: written.bytes,
              description: payload.warning,
            });
          }
        }

        if (files.length === 0) {
          throw new Error(`No files were exported:\n${failed.map((f) => f.error).join("\n")}`);
        }
        return { output: { files, failed }, content };
      }),
  );
}
