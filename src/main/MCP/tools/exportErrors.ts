import type { DesignExport } from "../scripts/exportDesign";
import type { ExportedNode } from "../scripts/exportNodes";

export function exportErrorMessage(
  item: ExportedNode | DesignExport,
  fileKey: string,
): string | null {
  if (!item.error) return null;
  const label = `Node "${item.id}"`;
  const described = item.type ? `${label} (${item.type} "${item.name}")` : label;
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
  }
}
