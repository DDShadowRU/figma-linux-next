import * as z from "zod/v4";
import type { ExportSpec } from "../scripts/exportNodes";
import { JPG, PNG, WEBP } from "./imageTypes";

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

export interface ServedType {
  mimeType: string;
  text?: true;
}

const SERVED_TYPES = new Map<string, ServedType>(
  [...Object.values(ASSET_FORMATS), WEBP].map((type) => [type.extension, type]),
);

export function findFormatByExtension(extension: string): ServedType | undefined {
  return SERVED_TYPES.get(extension);
}
