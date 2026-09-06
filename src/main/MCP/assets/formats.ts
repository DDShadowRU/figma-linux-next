import * as z from "zod/v4";
import type { ExportSpec } from "../scripts/exportNodes";

export const VECTOR_DRAWABLE = "vector-drawable";
export const assetFormatSchema = z.enum(["png", "jpg", "svg", VECTOR_DRAWABLE]);
export type AssetFormat = z.infer<typeof assetFormatSchema>;

export interface AssetFormatSpec {
  mimeType: string;
  extension: string;
  text?: true;
  settings(scale: number): ExportSpec;
}

export const ASSET_FORMATS: Record<AssetFormat, AssetFormatSpec> = {
  png: {
    mimeType: "image/png",
    extension: "png",
    settings: (scale) => ({ format: "PNG", constraint: { type: "SCALE", value: scale } }),
  },
  jpg: {
    mimeType: "image/jpeg",
    extension: "jpg",
    settings: (scale) => ({ format: "JPG", constraint: { type: "SCALE", value: scale } }),
  },
  svg: {
    mimeType: "image/svg+xml",
    extension: "svg",
    text: true,
    settings: () => ({ format: "SVG_STRING" }),
  },
  [VECTOR_DRAWABLE]: {
    mimeType: "application/xml",
    extension: "xml",
    text: true,
    settings: () => ({ format: "SVG_STRING" }),
  },
};

/** VectorDrawable needs Android Studio's converter, so it is offered only when one is configured. */
export function availableFormats(vectorDrawable: boolean): [AssetFormat, ...AssetFormat[]] {
  return vectorDrawable ? ["png", "jpg", "svg", VECTOR_DRAWABLE] : ["png", "jpg", "svg"];
}

export function findFormatByExtension(extension: string): AssetFormatSpec | undefined {
  return Object.values(ASSET_FORMATS).find((spec) => spec.extension === extension);
}
