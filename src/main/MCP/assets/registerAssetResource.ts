import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { findFormatByExtension } from "./formats";
import type { McpAssetStore } from "./McpAssetStore";

const ASSET_URI_TEMPLATE = new ResourceTemplate("file:///{+path}", {
  list: undefined,
});

export function registerAssetResource(server: McpServer, assets: McpAssetStore) {
  server.registerResource(
    "asset",
    ASSET_URI_TEMPLATE,
    {
      title: "Exported asset",
      description: "A file written by download_assets or download_image_fills",
    },
    async (uri) => {
      const notFound = () => new ResourceNotFoundError(uri.href);
      const filePath = assets.resolveInside(uri);
      if (!filePath) throw notFound();

      const spec = findFormatByExtension(path.extname(filePath).slice(1));
      if (!spec) throw notFound();

      const bytes = await readFile(filePath).catch(() => {
        throw notFound();
      });
      const body = spec.text
        ? { text: bytes.toString("utf8") }
        : { blob: bytes.toString("base64") };
      return {
        contents: [{ uri: uri.href, mimeType: spec.mimeType, ...body }],
      };
    },
  );
}
