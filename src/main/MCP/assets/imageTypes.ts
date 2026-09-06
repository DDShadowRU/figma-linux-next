export interface ImageType {
  extension: string;
  mimeType: string;
}

export const PNG: ImageType = { extension: "png", mimeType: "image/png" };
export const JPG: ImageType = { extension: "jpg", mimeType: "image/jpeg" };
export const WEBP: ImageType = { extension: "webp", mimeType: "image/webp" };

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageType(bytes: Buffer): ImageType | null {
  if (bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return PNG;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return JPG;
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return WEBP;
  }
  return null;
}
