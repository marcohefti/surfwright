import { chromium } from "playwright-core";
import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { fetchAssistedExtractItems, type ExtractItemDraft } from "./target-extract-assist.js";
import { frameScopeHints, parseFrameScope } from "./target-find.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, listCdpFrameEntries, openCdpSession } from "./cdp/index.js";
import { normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { extractFrameItems } from "./query/target-extract-frame.js";
import { parseJsonObjectText } from "./target-eval.js";
import type { TargetExtractReport } from "../../types.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

const EXTRACT_MAX_LIMIT = 100;
const EXTRACT_SCHEMA_MAX_FIELDS = 24;
const EXTRACT_SCHEMA_MAX_DEDUPE_FIELDS = 8;

function parseLimit(input: number | undefined): number {
  const value = input ?? 12;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > EXTRACT_MAX_LIMIT) {
    throw new CliError("E_QUERY_INVALID", `limit must be an integer between 1 and ${EXTRACT_MAX_LIMIT}`);
  }
  return value;
}

function parseKind(input: string | undefined): TargetExtractReport["kind"] {
  if (typeof input === "undefined" || input.trim().length === 0) {
    return "generic";
  }
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "blog" ||
    normalized === "news" ||
    normalized === "docs" ||
    normalized === "docs-commands" ||
    normalized === "command-lines" ||
    normalized === "headings" ||
    normalized === "links" ||
    normalized === "codeblocks" ||
    normalized === "forms" ||
    normalized === "tables" ||
    normalized === "table-rows" ||
    normalized === "generic"
  ) {
    return normalized;
  }
  throw new CliError(
    "E_QUERY_INVALID",
    "kind must be one of: generic, blog, news, docs, docs-commands, command-lines, headings, links, codeblocks, forms, tables, table-rows",
  );
}

type ParsedExtractSchema = {
  fields: Record<string, string>;
};

function parseExtractSchema(opts: {
  schemaJson?: string;
  schemaFile?: string;
}): ParsedExtractSchema | null {
  const inline = typeof opts.schemaJson === "string" ? opts.schemaJson.trim() : "";
  const file = typeof opts.schemaFile === "string" ? opts.schemaFile.trim() : "";
  const selected = Number(inline.length > 0) + Number(file.length > 0);
  if (selected === 0) {
    return null;
  }
  if (selected > 1) {
    throw new CliError("E_QUERY_INVALID", "Use either --schema-json or --schema-file, not both");
  }
  let text = inline;
  if (file.length > 0) {
    try {
      text = providers().fs.readFileSync(providers().path.resolve(file), "utf8");
    } catch {
      throw new CliError("E_QUERY_INVALID", "schema-file is not readable");
    }
  }
  const parsed = parseJsonObjectText({
    text,
    maxChars: 24 * 1024,
    tooLargeMessage: "schema JSON must be at most 24576 characters",
    invalidMessage: "schema JSON must be valid JSON object",
    objectMessage: "schema JSON must be an object of outputField -> sourcePath",
  });
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > EXTRACT_SCHEMA_MAX_FIELDS) {
    throw new CliError("E_QUERY_INVALID", `schema must contain 1..${EXTRACT_SCHEMA_MAX_FIELDS} field mappings`);
  }
  const fields: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (key.length < 1) {
      throw new CliError("E_QUERY_INVALID", "schema output field names must not be empty");
    }
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new CliError("E_QUERY_INVALID", `schema output field "${key}" must match [A-Za-z0-9_-]+`);
    }
    if (value.length < 1) {
      throw new CliError("E_QUERY_INVALID", `schema field "${key}" must map to a non-empty source path`);
    }
    fields[key] = value;
  }
  return { fields };
}

function parseDedupeBy(input: string | undefined): string[] {
  const value = typeof input === "string" ? input.trim() : "";
  if (value.length < 1) {
    return [];
  }
  const keys = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (keys.length > EXTRACT_SCHEMA_MAX_DEDUPE_FIELDS) {
    throw new CliError("E_QUERY_INVALID", `dedupe-by supports at most ${EXTRACT_SCHEMA_MAX_DEDUPE_FIELDS} fields`);
  }
  const deduped: string[] = [];
  for (const key of keys) {
    if (!deduped.includes(key)) {
      deduped.push(key);
    }
  }
  return deduped;
}

function scalarString(value: unknown): string | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function commandToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const stripped = value.trim().replace(/^(?:\$|#|>)\s*/, "");
  if (stripped.length < 1) {
    return null;
  }
  const token = stripped.split(/\s+/)[0]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function resolveSchemaPath(item: TargetExtractReport["items"][number], path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length < 1) {
    return null;
  }
  if (trimmed.startsWith("record.")) {
    const key = trimmed.slice("record.".length).trim();
    if (key.length < 1) {
      return null;
    }
    return scalarString(item.record?.[key]);
  }
  const parts = trimmed.split(".").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (parts.length < 1) {
    return null;
  }
  let current: unknown = item;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return scalarString(current);
}

export async function targetExtract(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  kind?: string;
  selectorQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  limit?: number;
  includeActionable?: boolean;
  schemaJson?: string;
  schemaFile?: string;
  dedupeBy?: string;
  summary?: boolean;
}): Promise<TargetExtractReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const kind = parseKind(opts.kind);
  const limit = parseLimit(opts.limit);
  const includeActionable = Boolean(opts.includeActionable);
  const includeSummary = Boolean(opts.summary);
  const schema = parseExtractSchema({
    schemaJson: opts.schemaJson,
    schemaFile: opts.schemaFile,
  });
  const dedupeBy = parseDedupeBy(opts.dedupeBy);
  if (!schema && dedupeBy.length > 0) {
    throw new CliError("E_QUERY_INVALID", "dedupe-by requires --schema-json or --schema-file");
  }
  if (schema) {
    for (const dedupeField of dedupeBy) {
      if (!Object.prototype.hasOwnProperty.call(schema.fields, dedupeField)) {
        throw new CliError("E_QUERY_INVALID", `dedupe-by field "${dedupeField}" is not present in schema output fields`);
      }
    }
  }

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const pageUrl = target.page.url();
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const frameCount = listCdpFrameEntries({ frameTree, limit: 1 }).count;
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });
    const allEntries = listCdpFrameEntries({ frameTree, limit: Number.MAX_SAFE_INTEGER }).entries;
    const urlByFrameId = new Map<string, string>();
    for (const entry of allEntries) {
      urlByFrameId.set(entry.cdpFrameId, entry.url);
    }
    const hints = frameScopeHints({
      frameScope,
      frameCount,
      command: "target.extract",
      targetId: requestedTargetId,
    });
    const worldCache = new Map<string, number>();
    if (selectorQuery) {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery,
      });
    }

    let scopeMatched = false;
    const seen = new Set<string>();
    const merged: TargetExtractReport["items"] = [];
    const sourcesTried: string[] = ["dom"];
    let source: TargetExtractReport["source"] = "dom";
    let totalRawCount = 0;

    const pushItem = (item: ExtractItemDraft) => {
      const title = item.title.trim();
      const url = typeof item.url === "string" && item.url.length > 0 ? item.url : null;
      const dedupeKey = `${url ?? "no-url"}::${title}`.toLowerCase();
      if (seen.has(dedupeKey) || merged.length >= limit) {
        return;
      }
      seen.add(dedupeKey);
      merged.push({
        index: merged.length,
        title,
        url,
        summary: item.summary,
        publishedAt: item.publishedAt,
        frameUrl: item.frameUrl,
        ...(typeof item.language !== "undefined" ? { language: item.language ?? null } : {}),
        ...(typeof item.command !== "undefined" ? { command: item.command ?? null } : {}),
        ...(typeof item.section !== "undefined" ? { section: item.section ?? null } : {}),
        ...(typeof item.record !== "undefined" ? { record: item.record } : {}),
        ...(includeActionable
          ? {
              actionable: {
                handle: item.actionable?.handle ?? null,
                selectorHint: item.actionable?.selectorHint ?? null,
                frameId: item.actionable?.frameId ?? null,
                href: item.actionable?.href ?? url,
              },
            }
          : {}),
      });
    };

    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({
        cdp,
        frameCdpId,
        worldCache,
      });
      const extracted = await extractFrameItems({
        evaluator,
        frameUrl: urlByFrameId.get(frameCdpId) ?? pageUrl,
        frameId: frameCdpId,
        selectorQuery,
        visibleOnly,
        kind,
        scanLimit: limit,
        includeActionable,
      });
      scopeMatched = scopeMatched || extracted.matched;
      totalRawCount += extracted.items.length;
      for (const item of extracted.items) {
        pushItem(item);
      }
    }

    if ((kind === "generic" || kind === "blog" || kind === "news" || kind === "docs") && merged.length === 0) {
      const assisted = await fetchAssistedExtractItems({
        pageUrl,
        kind,
        limit,
      });
      if (assisted.sourcesTried.length > 0) {
        sourcesTried.push(...assisted.sourcesTried);
      }
      if (assisted.items.length > 0) {
        source = "api-feed";
        totalRawCount += assisted.items.length;
        for (const item of assisted.items) {
          pushItem(item);
        }
        hints.push("Structured items were recovered via API/feed fallback.");
      }
    }

    if (merged.length === 0) {
      hints.push(`No structured items found for kind=${kind}.`);
      hints.push(`Try: surfwright target extract ${requestedTargetId} --kind blog --frame-scope all --limit 10`);
      hints.push(`Try: surfwright target snapshot ${requestedTargetId} --frame-scope all --max-headings 30 --max-links 50`);
      hints.push(`Try: surfwright target health ${requestedTargetId}`);
    }

    const mappedRecords = (() => {
      if (!schema) {
        return null;
      }
      const rows: Array<Record<string, string | null>> = [];
      const seen = new Set<string>();
      for (const item of merged) {
        const row = Object.fromEntries(
          Object.entries(schema.fields).map(([field, path]) => [field, resolveSchemaPath(item, path)]),
        ) as Record<string, string | null>;
        if (dedupeBy.length > 0) {
          const dedupeKey = dedupeBy.map((field) => row[field] ?? "").join("||").toLowerCase();
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);
        }
        rows.push(row);
      }
      return rows;
    })();
    if (schema) {
      hints.push("Schema mapping enabled: use records[] for deterministic extraction without target.eval.");
    }

    const actionCompletedAt = Date.now();
    const firstItem = merged[0] ?? null;
    const summary = includeSummary
      ? {
          count: totalRawCount,
          itemCount: merged.length,
          totalRawCount,
          truncated: totalRawCount > merged.length,
          firstTitle: firstItem?.title ?? null,
          firstUrl: firstItem?.url ?? null,
          firstCommand: commandToken(firstItem?.command),
          source,
        }
      : null;
    const report: TargetExtractReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: pageUrl,
      title: await target.page.title(),
      kind,
      source,
      sourcesTried,
      scope: {
        selector: selectorQuery,
        matched: scopeMatched,
        visibleOnly,
        frameScope,
      },
      limit,
      count: totalRawCount,
      items: merged,
      ...(schema
        ? {
            schema: {
              fields: schema.fields,
              dedupeBy,
            },
            records: mappedRecords ?? [],
          }
        : {}),
      ...(summary ? { summary, proof: summary } : {}),
      truncated: totalRawCount > merged.length,
      hints,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
