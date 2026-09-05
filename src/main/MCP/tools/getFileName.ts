import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { GET_FILE_NAME_SCRIPT } from "../scripts";
import type { ToolContext } from "./context";
import { runTool } from "./runTool";
import { fileKeySchema } from "./schemas";

export function registerGetFileName(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "get_file_name",
    {
      title: "Get file name",
      description: "Returns the name of a Figma file by its fileKey",
      inputSchema: z.object({ fileKey: fileKeySchema }),
      outputSchema: z.object({ name: z.string() }),
      annotations: { readOnlyHint: true },
    },
    ({ fileKey }) =>
      runTool("get_file_name", async () => {
        const session = await ctx.files.open(fileKey);
        return { output: await session.execJson<{ name: string }>(GET_FILE_NAME_SCRIPT) };
      }),
  );
}
