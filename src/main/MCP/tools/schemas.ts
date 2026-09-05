import * as z from "zod/v4";

export const fileKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/, "fileKey must be alphanumeric")
  .describe(
    "Figma file key — the id in figma.com/design/<fileKey>/… or figma.com/file/<fileKey>/…",
  );
