import * as z from "zod/v4";
import type { ExportSpec } from "../scripts/exportNodes";
import { JPG, PNG } from "./imageTypes";

export const VECTOR_DRAWABLE = "vector-drawable";
export const assetFormatSchema = z.enum(["png", "jpg", "svg", VECTOR_DRAWABLE]);
export type AssetFormat = z.infer<typeof assetFormatSchema>;

export interface AssetFormatSpec {
  mimeType: string;
  extension: string;
  settings(scale: number): ExportSpec;
}

export const ASSET_FORMATS: Record<AssetFormat, AssetFormatSpec> = {
  png: {
    ...PNG,
    settings: (scale) => ({
      format: "PNG",
      constraint: { type: "SCALE", value: scale },
    }),
  },
  jpg: {
    ...JPG,
    settings: (scale) => ({
      format: "JPG",
      constraint: { type: "SCALE", value: scale },
    }),
  },
  svg: {
    mimeType: "image/svg+xml",
    extension: "svg",
    settings: () => ({ format: "SVG_STRING" }),
  },
  [VECTOR_DRAWABLE]: {
    mimeType: "application/xml",
    extension: "xml",
    settings: () => ({ format: "SVG_STRING" }),
  },
};

/** VectorDrawable needs Android Studio's converter, so it is offered only when one is configured. */
export function availableFormats(vectorDrawable: boolean): [AssetFormat, ...AssetFormat[]] {
  return vectorDrawable ? ["png", "jpg", "svg", VECTOR_DRAWABLE] : ["png", "jpg", "svg"];
}
