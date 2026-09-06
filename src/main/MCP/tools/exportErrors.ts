import type { DesignExport } from "../scripts/exportDesign";
import type {
  ImageFillError,
  ImageFillsNode,
} from "../scripts/exportImageFills";
import type { ExportedNode } from "../scripts/exportNodes";

const describe = (item: { id: string; type?: string; name?: string }) =>
  item.type
    ? `Node "${item.id}" (${item.type} "${item.name}")`
    : `Node "${item.id}"`;

export function exportErrorMessage(
  item: ExportedNode | DesignExport | ImageFillsNode,
  fileKey: string,
): string | null {
  if (!item.error) return null;
  const label = `Node "${item.id}"`;
  const described = describe(item);
  switch (item.error) {
    case "not_found":
      return `${label} not found in file ${fileKey}`;
    case "not_exportable":
      return `${described} cannot be exported`;
    case "hidden":
      return `${described} is hidden (visible: false)`;
    case "no_size":
      return `${described} has no renderable size`;
    case "export_failed":
      return `Export of ${described} failed: ${item.message}`;
    case "skipped":
      return `${label} skipped: the export budget was used up by earlier nodes`;
    case "raw_too_large": {
      const mb = Math.round((item.bytes ?? 0) / 1048576);
      return `${described} is too large to read (${mb} MB of design data): pass a smaller depth or request a child frame`;
    }
    case "no_image_fills":
      return `${described} has no image fill: look in get_design for a fill with an imageRef, or render the node itself with download_assets`;
    case "fills_hidden":
      return `${described} has image fills, but all of them are hidden (visible: false)`;
    case "mixed_fills":
      return `${described} has different fills per character: ask for the image on the frame or shape behind the text instead`;
    case "video_fill":
      return `${described} has a video fill: Figma keeps no downloadable original for it, use get_screenshot or download_assets for a still`;
  }
}

export type FillProblem = {
  error: ImageFillError | "unsupported_format";
  message?: string;
};

export function imageFillErrorMessage(
  problem: FillProblem,
  imageRef: string,
  node: ImageFillsNode,
): string {
  const of = `${imageRef ? `Image fill "${imageRef}"` : "An image fill"} of ${describe(node)}`;
  switch (problem.error) {
    case "image_missing":
      return `${of} has no stored file`;
    case "read_failed":
      return `Reading ${of} failed: ${problem.message}`;
    case "unsupported_format":
      return `${of} is stored in a format this tool does not support (png, jpg and webp only)`;
    case "skipped":
      return `${of} skipped: the export budget was used up by earlier fills`;
  }
}
