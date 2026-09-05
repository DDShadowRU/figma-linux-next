import type { ExportedNode } from "../scripts/exportNodes";

export function exportErrorMessage(
  item: ExportedNode,
  fileKey: string,
  requestedId: string,
): string | null {
  if (!item.error) return null;
  const label = `Node "${item.id}"`;
  const described = item.type ? `${label} (${item.type} "${item.name}")` : label;
  switch (item.error) {
    case "not_found": {
      const origin = item.id !== requestedId ? ` (normalised from "${requestedId}")` : "";
      return `${label} not found in file ${fileKey}${origin}`;
    }
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
  }
}
