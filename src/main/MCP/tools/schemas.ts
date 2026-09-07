import * as z from "zod/v4";
import { ASSET_MAX_SCALE, ASSET_MIN_SCALE } from "../config";

export const fileKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/, "fileKey must be alphanumeric")
  .describe(
    "Figma file key — the id in figma.com/design/<fileKey>/… or figma.com/file/<fileKey>/…",
  );

export const nodeIdSchema = z
  .string()
  .regex(
    /^I?\d+[:-]\d+(?:;\d+[:-]\d+)*$/,
    'nodeId must look like "1015:50826", "1015-50826" or "I5752:65667;469:26400"',
  )
  .describe(
    'Node id: "1015:50826", the URL form "1015-50826" (node-id=… in a Figma link), ' +
      'or an instance child "I5752:65667;469:26400"',
  );

export const normalizeNodeId = (raw: string) => raw.replace(/-/g, ":");

const scaleSchema = (note: string) =>
  z
    .number()
    .min(ASSET_MIN_SCALE)
    .max(ASSET_MAX_SCALE)
    .describe(`Render scale, ${ASSET_MIN_SCALE}–${ASSET_MAX_SCALE} (1 = design pixels); ${note}`);

export const assetScaleSchema = scaleSchema("ignored for svg");

export const screenshotScaleSchema = scaleSchema(
  "may be lowered to keep the image within the size limit",
);
