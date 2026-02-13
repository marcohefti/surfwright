import type { TargetExtractReport } from "../types.js";

const FEED_FALLBACK_TIMEOUT_MS = 2500;

export type ExtractItemDraft = {
  title: string;
  url: string | null;
  summary: string | null;
  publishedAt: string | null;
  frameUrl: string;
};

export function normalizeExtractWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function maybeAbsoluteUrl(opts: { base: string; value: string | null; kind: TargetExtractReport["kind"]; slug: string | null }): string | null {
  if (typeof opts.value === "string" && opts.value.length > 0) {
    try {
      return new URL(opts.value, opts.base).toString();
    } catch {
      return null;
    }
  }
  if (typeof opts.slug === "string" && opts.slug.length > 0) {
    try {
      if (opts.kind === "blog") {
        return new URL(`/p/${opts.slug}`, opts.base).toString();
      }
      return new URL(`/${opts.slug}`, opts.base).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function toJsonRecordItem(opts: {
  record: Record<string, unknown>;
  baseUrl: string;
  kind: TargetExtractReport["kind"];
  sourceUrl: string;
}): ExtractItemDraft | null {
  const title = pickString(opts.record, ["title", "headline", "name"]);
  if (!title) {
    return null;
  }
  const slug = pickString(opts.record, ["slug", "post_slug", "handle"]);
  const url = maybeAbsoluteUrl({
    base: opts.baseUrl,
    value: pickString(opts.record, ["canonical_url", "canonicalUrl", "url", "permalink", "path", "href", "web_url"]),
    kind: opts.kind,
    slug,
  });
  const summary = pickString(opts.record, ["subtitle", "summary", "description", "excerpt"]);
  const publishedAt = pickString(opts.record, ["post_date", "publishedAt", "published_at", "date", "updated_at", "created_at"]);
  return {
    title: normalizeExtractWhitespace(title),
    url,
    summary: summary ? normalizeExtractWhitespace(summary) : null,
    publishedAt,
    frameUrl: opts.sourceUrl,
  };
}

function collectJsonItems(opts: {
  value: unknown;
  baseUrl: string;
  kind: TargetExtractReport["kind"];
  sourceUrl: string;
  limit: number;
}): ExtractItemDraft[] {
  const out: ExtractItemDraft[] = [];
  const visited = new Set<object>();
  const walk = (value: unknown, depth: number) => {
    if (out.length >= opts.limit || depth > 5) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        walk(entry, depth + 1);
        if (out.length >= opts.limit) {
          return;
        }
      }
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const objectValue = value as Record<string, unknown>;
    if (visited.has(objectValue)) {
      return;
    }
    visited.add(objectValue);
    const item = toJsonRecordItem({
      record: objectValue,
      baseUrl: opts.baseUrl,
      kind: opts.kind,
      sourceUrl: opts.sourceUrl,
    });
    if (item) {
      out.push(item);
      if (out.length >= opts.limit) {
        return;
      }
    }
    for (const nested of Object.values(objectValue)) {
      walk(nested, depth + 1);
      if (out.length >= opts.limit) {
        return;
      }
    }
  };
  walk(opts.value, 0);
  return out;
}

function parseXmlTag(block: string, names: string[]): string | null {
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
    const match = block.match(pattern);
    if (match && typeof match[1] === "string") {
      const value = normalizeExtractWhitespace(decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")));
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function parseXmlLink(block: string): string | null {
  const hrefAttr = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefAttr && typeof hrefAttr[1] === "string") {
    return hrefAttr[1];
  }
  const content = parseXmlTag(block, ["link"]);
  return content;
}

function collectXmlItems(opts: {
  xml: string;
  baseUrl: string;
  sourceUrl: string;
  limit: number;
}): ExtractItemDraft[] {
  const out: ExtractItemDraft[] = [];
  const blocks = opts.xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    if (out.length >= opts.limit) {
      break;
    }
    const title = parseXmlTag(block, ["title"]);
    if (!title) {
      continue;
    }
    const url = maybeAbsoluteUrl({
      base: opts.baseUrl,
      value: parseXmlLink(block),
      kind: "blog",
      slug: null,
    });
    const summary = parseXmlTag(block, ["description", "summary", "content"]);
    const publishedAt = parseXmlTag(block, ["pubDate", "updated", "published"]);
    out.push({
      title,
      url,
      summary,
      publishedAt,
      frameUrl: opts.sourceUrl,
    });
  }
  return out;
}

export async function fetchAssistedExtractItems(opts: {
  pageUrl: string;
  kind: TargetExtractReport["kind"];
  limit: number;
}): Promise<{ items: ExtractItemDraft[]; sourcesTried: string[] }> {
  let base: URL;
  try {
    base = new URL(opts.pageUrl);
  } catch {
    return { items: [], sourcesTried: [] };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { items: [], sourcesTried: [] };
  }

  const jsonPaths = ["/api/v1/homepage_data", "/api/v1/posts", "/api/v1/archive"];
  const xmlPaths = ["/feed", "/rss", "/atom.xml"];
  const sourcesTried: string[] = [];
  const items: ExtractItemDraft[] = [];
  const append = (next: ExtractItemDraft[]) => {
    for (const item of next) {
      if (items.length >= opts.limit) {
        break;
      }
      items.push(item);
    }
  };

  for (const endpoint of jsonPaths) {
    if (items.length >= opts.limit) {
      break;
    }
    const url = new URL(endpoint, base).toString();
    sourcesTried.push(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_FALLBACK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json")) {
        continue;
      }
      const data = (await response.json()) as unknown;
      append(
        collectJsonItems({
          value: data,
          baseUrl: base.toString(),
          kind: opts.kind,
          sourceUrl: url,
          limit: opts.limit - items.length,
        }),
      );
    } catch {
      // best-effort fallback only
    } finally {
      clearTimeout(timer);
    }
  }

  for (const endpoint of xmlPaths) {
    if (items.length >= opts.limit) {
      break;
    }
    const url = new URL(endpoint, base).toString();
    sourcesTried.push(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_FALLBACK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      });
      if (!response.ok) {
        continue;
      }
      const xml = await response.text();
      append(
        collectXmlItems({
          xml,
          baseUrl: base.toString(),
          sourceUrl: url,
          limit: opts.limit - items.length,
        }),
      );
    } catch {
      // best-effort fallback only
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    items,
    sourcesTried,
  };
}
