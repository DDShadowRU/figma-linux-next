import * as z from "zod/v4";
import type { ExportSpec } from "../scripts/exportNodes";

export const assetFormatSchema = z.enum(["png", "jpg", "svg"]);
export type AssetFormat = z.infer<typeof assetFormatSchema>;

export interface AssetFormatSpec {
  mimeType: string;
  settings(scale: number): ExportSpec;
}

export const ASSET_FORMATS: Record<AssetFormat, AssetFormatSpec> = {
  png: {
    mimeType: "image/png",
    settings: (scale) => ({ format: "PNG", constraint: { type: "SCALE", value: scale } }),
  },
  jpg: {
    mimeType: "image/jpeg",
    settings: (scale) => ({ format: "JPG", constraint: { type: "SCALE", value: scale } }),
  },
  svg: {
    mimeType: "image/svg+xml",
    settings: () => ({ format: "SVG_STRING" }),
  },
};
