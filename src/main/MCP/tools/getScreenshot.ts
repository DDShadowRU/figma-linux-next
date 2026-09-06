import type { McpServer } from "@modelcontextprotocol/server";
import { nativeImage } from "electron";
import * as z from "zod/v4";
import { ASSET_FORMATS } from "../assets/formats";
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_EDGE, SCREENSHOT_MIN_EDGE } from "../config";
import { exportNodes } from "../scripts/exportNodes";
import type { ToolContext } from "./context";
import { exportErrorMessage } from "./exportErrors";
import { runTool } from "./runTool";
import { fileKeySchema, nodeIdSchema, normalizeNodeId } from "./schemas";

const PNG = ASSET_FORMATS.png;

const inputSchema = z.object({ fileKey: fileKeySchema, nodeId: nodeIdSchema });

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
    ({ fileKey, nodeId }) =>
      runTool("get_screenshot", async () => {
        const id = normalizeNodeId(nodeId);
        const item = await ctx.files.withFile(fileKey, async (session) => {
          const render = async (maxEdge: number) => {
            const fit = { min: SCREENSHOT_MIN_EDGE, max: maxEdge };
            const [item] = await exportNodes(session, [{ id, spec: { format: "PNG", fit } }]);
            const error = exportErrorMessage(item, fileKey);
            if (error) throw new Error(error);
            return item;
          };

          const full = await render(SCREENSHOT_MAX_EDGE);
          if (Buffer.byteLength(full.data, "base64") <= SCREENSHOT_MAX_BYTES) return full;
          return render(SCREENSHOT_MAX_EDGE / 2);
        });

        const image = nativeImage.createFromBuffer(Buffer.from(item.data, "base64")).getSize();
        const scale = Math.round((image.width / item.width) * 1000) / 1000;
        return {
          output: { node: { width: item.width, height: item.height }, image, scale },
          content: [{ type: "image", data: item.data, mimeType: PNG.mimeType }],
        };
      }),
  );
}
