const MAX_SLUG_LENGTH = 64;

export function slugify(name: string, fallbackId: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug || `node-${fallbackId.replace(/:/g, "-").replace(/;/g, "_")}`;
}

// Android resource names allow only [a-z0-9_] and must start with a letter.
export function androidResourceName(name: string, fallbackId: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/, "");
  if (/^[a-z]/.test(slug)) return slug;
  return `node_${slug || fallbackId.replace(/[:;]/g, "_")}`;
}

export function reserveBaseName(base: string, separator: string, taken: Set<string>): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}${separator}${n}`;
  taken.add(candidate);
  return candidate;
}
