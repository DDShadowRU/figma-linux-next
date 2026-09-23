import { createHash } from "node:crypto";
import type { GradientPaint, Paint, RGBA } from "@figma/rest-api-spec";
import type { ExtractorFn, TraversalContext } from "figma-developer-mcp";
import type { Paints } from "./simplify";

type Vec = { x: number; y: number };
type Stop = { pos: number; color: RGBA };

const PAINT_FIELDS = [
  { field: "fills", styleKeys: ["fill", "fills"] },
  { field: "strokes", styleKeys: ["stroke", "strokes"] },
] as const;

/**
 * Framelink maps linear gradients in the 0..1 box space, ignoring the node's
 * aspect ratio, and clamps a stop that lies outside the box to 0%/100% while
 * keeping its colour, so a gradient whose handles reach past the edges starts
 * with a colour that is never visible. This recomputes them from the node size.
 *
 * The result depends on the size, so one named style can yield several values:
 * the first keeps the style's key, the others get `Name (WxH)`. Keys the package
 * wrote and nothing points at any more are dropped by its own dedup pass.
 */
export function linearGradientExtractor(): ExtractorFn {
  const namedVariants = new Map<string, { base: string; keys: Map<string, string> }>();

  return (raw, node, ctx) => {
    for (const { field, styleKeys } of PAINT_FIELDS) {
      const paints = (raw as { [key in typeof field]?: Paint[] })[field];
      const ref = node[field];
      if (!Array.isArray(paints) || typeof ref !== "string") continue;
      if (!paints.some((paint) => paint.visible !== false && paint.type === "GRADIENT_LINEAR")) {
        continue;
      }
      const size = nodeSize(raw);
      const visible = paints.filter((paint) => paint.visible !== false);
      const current = ctx.globalVars.styles[ref] as Paints | undefined;
      if (!size || !Array.isArray(current) || current.length !== visible.length) continue;

      const next = [...current];
      let changed = false;
      visible.forEach((paint, i) => {
        if (paint.type !== "GRADIENT_LINEAR") return;
        const gradient = linearGradientCss(paint, size.width, size.height);
        const index = next.length - 1 - i;
        if (!gradient || (next[index] as { gradient?: string }).gradient === gradient) return;
        next[index] = { type: paint.type, gradient };
        changed = true;
      });
      const json = JSON.stringify(next);

      const styles = "styles" in raw ? raw.styles : undefined;
      const styleId = styleKeys.map((key) => styles?.[key]).find(Boolean);
      const styleName = styleId ? ctx.extraStyles?.[styleId]?.name : undefined;
      if (styleId && styleName) {
        let variants = namedVariants.get(styleId);
        if (!variants) {
          variants = { base: ref, keys: new Map() };
          namedVariants.set(styleId, variants);
        }
        let key = variants.keys.get(json);
        if (!key) {
          key = variants.keys.size === 0 ? variants.base : sizedKey(variants.base, size, ctx);
          variants.keys.set(json, key);
          ctx.globalVars.styles[key] = next;
          ctx.traversalState.namedStyleKeys.add(key);
        }
        node[field] = key;
      } else if (changed) {
        node[field] = hashedKey(next, json, ctx);
      }
    }
  };
}

function nodeSize(raw: Parameters<ExtractorFn>[0]): { width: number; height: number } | undefined {
  if ("size" in raw && raw.size) return { width: raw.size.x, height: raw.size.y };
  if ("absoluteBoundingBox" in raw && raw.absoluteBoundingBox) return raw.absoluteBoundingBox;
  return undefined;
}

function sizedKey(base: string, size: { width: number; height: number }, ctx: TraversalContext) {
  const name = `${base} (${Math.round(size.width)}x${Math.round(size.height)})`;
  let key = name;
  for (let n = 2; ctx.globalVars.styles[key] !== undefined; n++) key = `${name} ${n}`;
  return key;
}

function hashedKey(paints: Paints, json: string, ctx: TraversalContext) {
  const hash = createHash("sha1").update(json).digest("hex");
  const taken = (key: string) => {
    const value = ctx.globalVars.styles[key];
    return value !== undefined && JSON.stringify(value) !== json;
  };
  let length = 8;
  while (taken(`fill_${hash.slice(0, length)}`) && length < hash.length) length += 4;
  const key = `fill_${hash.slice(0, length)}`;
  ctx.globalVars.styles[key] = paints;
  return key;
}

/**
 * The handles are in 0..1 box space: the first is t=0, the second t=1, and the
 * third sets the direction of the lines of equal colour. Figma's gradient is
 * affine, so t is linear in pixels too; CSS 0% and 100% are the lines through
 * the extreme corners, which makes them the corners' lowest and highest t.
 */
export function linearGradientCss(
  paint: GradientPaint,
  width: number,
  height: number,
): string | undefined {
  const [h0, h1, h2] = paint.gradientHandlePositions ?? [];
  if (!h2 || !(width > 0) || !(height > 0) || paint.gradientStops.length === 0) return;

  const toPx = (v: Vec) => ({ x: v.x * width, y: v.y * height });
  const p0 = toPx(h0);
  const along = sub(toPx(h1), p0);
  const across = sub(toPx(h2), p0);
  const det = cross(along, across);
  if (Math.abs(det) < 1e-9) return;

  const tAt = (q: Vec) => cross(sub(q, p0), across) / det;
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map(tAt);
  const from = Math.min(...corners);
  const span = Math.max(...corners) - from;
  if (span < 1e-9) return;

  const normal = { x: across.y / det, y: -across.x / det };
  const angle = round1(((Math.atan2(normal.x, -normal.y) * 180) / Math.PI + 360) % 360);

  const stops = [...paint.gradientStops]
    .sort((a, b) => a.position - b.position)
    .map(({ position, color }) => ({ pos: (position - from) / span, color }));
  const opacity = paint.opacity ?? 1;
  const list = visibleStops(stops)
    .map(({ pos, color }) => `${rgba(color, opacity)} ${round1(pos * 100)}%`)
    .join(", ");
  return `linear-gradient(${angle}deg, ${list})`;
}

function visibleStops(stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  if (stops[0].pos < 0) out.push({ pos: 0, color: colorAt(stops, 0) });
  for (const stop of stops) if (stop.pos >= 0 && stop.pos <= 1) out.push(stop);
  if (stops[stops.length - 1].pos > 1) out.push({ pos: 1, color: colorAt(stops, 1) });
  if (out.length === 1) out.push({ pos: 1, color: out[0].color });
  return out;
}

function colorAt(stops: Stop[], pos: number): RGBA {
  const after = stops.findIndex((stop) => stop.pos >= pos);
  if (after === -1) return stops[stops.length - 1].color;
  if (after === 0) return stops[0].color;
  const a = stops[after - 1];
  const b = stops[after];
  const k = (pos - a.pos) / (b.pos - a.pos);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    r: mix(a.color.r, b.color.r),
    g: mix(a.color.g, b.color.g),
    b: mix(a.color.b, b.color.b),
    a: mix(a.color.a, b.color.a),
  };
}

const rgba = (c: RGBA, opacity: number) =>
  `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${
    Math.round(opacity * c.a * 100) / 100
  })`;

const round1 = (value: number) => Math.round(value * 10) / 10 || 0;

const sub = (a: Vec, b: Vec) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
