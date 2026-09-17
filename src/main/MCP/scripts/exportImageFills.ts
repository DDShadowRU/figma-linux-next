import { EXPORT_BUDGET } from "../config";
import type { McpFileSession } from "../files/McpFileSession";
import { EXPORT_DEADLINE_JS } from "./index";

export type ImageFillsNodeError =
  | "not_found"
  | "hidden"
  | "mixed_fills"
  | "no_image_fills"
  | "fills_hidden"
  | "video_fill"
  | "export_failed";

export type ImageFillError = "image_missing" | "read_failed" | "stalled" | "skipped";

export interface ImageFill {
  imageRef: string;
  imageTransform?: number[][];
}

export interface ImageFillsNode {
  id: string;
  name?: string;
  type?: string;
  fills?: ImageFill[];
  error?: ImageFillsNodeError;
  message?: string;
}

export type ImageSource =
  | { width: number; height: number; data: string }
  | { error: ImageFillError; message?: string };

export interface ImageFillsExport {
  items: ImageFillsNode[];
  sources: Record<string, ImageSource>;
}

export function exportImageFills(
  session: McpFileSession,
  ids: string[],
): Promise<ImageFillsExport> {
  return session.execJson<ImageFillsExport>(buildExportImageFillsScript(ids));
}

export const buildExportImageFillsScript = (ids: string[]) => `(async () => {
  try {
    const figma = window.figma;
    if (!figma || !figma.root) return JSON.stringify({ error: "Figma Plugin API is not available" });
    const ids = ${JSON.stringify(ids)};
    const budget = ${JSON.stringify(EXPORT_BUDGET)};
    const started = performance.now();
${EXPORT_DEADLINE_JS}
    let bytesTotal = 0;
    const items = [];
    const sources = {};

    // Figma reports an identity transform on every uncropped fill; only a real crop is news.
    const cropOf = (t) =>
      t && !(t[0][0] === 1 && t[0][1] === 0 && t[0][2] === 0 &&
             t[1][0] === 0 && t[1][1] === 1 && t[1][2] === 0)
        ? t
        : null;

    const readSource = async (hash) => {
      if (!hash) return { error: "image_missing" };
      if (performance.now() - started > budget.timeMs || bytesTotal > budget.bytes) {
        return { error: "skipped" };
      }
      try {
        // The sync getImageByHash throws in a dynamic-page document.
        const image =
          typeof figma.getImageByHashAsync === "function"
            ? await figma.getImageByHashAsync(hash)
            : figma.getImageByHash(hash);
        if (!image) return { error: "image_missing" };
        const [size, bytes] = await withDeadline(
          Promise.all([image.getSizeAsync(), image.getBytesAsync()]),
        );
        bytesTotal += bytes.length;
        return { width: size.width, height: size.height, data: figma.base64Encode(bytes) };
      } catch (e) {
        if (e === stalled) return { error: "stalled" };
        return { error: "read_failed", message: String((e && e.message) || e) };
      }
    };

    for (const id of ids) {
      const item = { id };
      items.push(item);
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) {
          item.error = "not_found";
          continue;
        }
        item.name = node.name;
        item.type = node.type;
        if (node.visible === false) {
          item.error = "hidden";
          continue;
        }
        const paints = node.fills;
        if (paints === figma.mixed) {
          item.error = "mixed_fills";
          continue;
        }
        if (!Array.isArray(paints)) {
          item.error = "no_image_fills";
          continue;
        }
        const imagePaints = paints.filter((paint) => paint && paint.type === "IMAGE");
        const visible = imagePaints.filter((paint) => paint.visible !== false);
        if (visible.length === 0) {
          item.error = imagePaints.length > 0
            ? "fills_hidden"
            : paints.some((paint) => paint && paint.type === "VIDEO")
              ? "video_fill"
              : "no_image_fills";
          continue;
        }
        // Figma stacks fills bottom-first, get_design prints them top-first.
        item.fills = [];
        for (const paint of visible.slice().reverse()) {
          const fill = { imageRef: paint.imageHash || "" };
          item.fills.push(fill);
          const crop = cropOf(paint.imageTransform);
          if (crop) fill.imageTransform = crop;
          if (sources[fill.imageRef] === undefined) {
            sources[fill.imageRef] = await readSource(fill.imageRef);
          }
        }
      } catch (e) {
        item.error = "export_failed";
        item.message = String((e && e.message) || e);
      }
    }
    return JSON.stringify({ items, sources });
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) });
  }
})()`;
