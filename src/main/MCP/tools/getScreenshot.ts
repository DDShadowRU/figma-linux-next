import type { McpServer } from "@modelcontextprotocol/server";
import { nativeImage } from "electron";
import * as z from "zod/v4";
import { ASSET_FORMATS } from "../assets/formats";
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_EDGE } from "../config";
import { exportNodes } from "../scripts/exportNodes";
import type { ToolContext } from "./context";
import { exportErrorMessage } from "./exportErrors";
import { runTool } from "./runTool";
import { fileKeySchema, nodeIdSchema, normalizeNodeId, screenshotScaleSchema } from "./schemas";

const PNG = ASSET_FORMATS.png;

const inputSchema = z.object({
  fileKey: fileKeySchema,
  nodeId: nodeIdSchema,
  scale: screenshotScaleSchema.default(1),
});

const outputSchema = z.object({
  node: z.object({ width: z.number(), height: z.number() }).describe("Node size in design px"),
  image: z.object({ width: z.number(), height: z.number() }).describe("Image size in px"),
  scale: z.number().describe("image px per design px"),
});

export function registerGetScreenshot(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_screenshot",
    {
      title: "Get screenshot",
      description: "Render one node of a Figma file to a PNG for viewing",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ fileKey, nodeId, scale }) => {
      const id = normalizeNodeId(nodeId);
      const detail = `node=${id} scale=${scale}`;
      return runTool({ tool: "get_screenshot", fileKey, detail }, async () => {
        const item = await ctx.files.withFile(fileKey, async (session) => {
          // Shrinking the cap with the scale is what halves an image that rendered at the cap.
          const render = async (shrink: number) => {
            const fit = { scale: scale / shrink, maxEdge: SCREENSHOT_MAX_EDGE / shrink };
            const [item] = await exportNodes(session, [{ id, spec: { format: "PNG", fit } }]);
            const error = exportErrorMessage(item, fileKey);
            if (error) throw new Error(error);
            return item;
          };

          const full = await render(1);
          if (Buffer.byteLength(full.data, "base64") <= SCREENSHOT_MAX_BYTES) return full;
          return render(2);
        });

        const image = nativeImage.createFromBuffer(Buffer.from(item.data, "base64")).getSize();
        return {
          output: {
            node: { width: item.width, height: item.height },
            image,
            scale: Math.round((image.width / item.width) * 1000) / 1000,
          },
          content: [{ type: "image", data: item.data, mimeType: PNG.mimeType }],
        };
      });
    },
  );
}
