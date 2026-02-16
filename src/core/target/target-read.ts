import { chromium, type Locator } from "playwright-core";
import { newActionId } from "../action-id.js";
import { CliError } from "../errors.js";
import { nowIso } from "../state/index.js";
import { saveTargetSnapshot } from "../state/index.js";
import { DEFAULT_TARGET_READ_CHUNK_SIZE } from "../types.js";
import { providers } from "../providers/index.js";
import { frameScopeHints, framesForScope, parseFrameScope } from "./target-find.js";
import { ensureValidSelector, normalizeSelectorQuery, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import type { TargetReadReport } from "../types.js";
const READ_MAX_CHUNK_SIZE = 10000;
const READ_MAX_CHUNK_INDEX = 100000;
const FORM_FILL_MAX_FIELDS = 80;
const FORM_FILL_MAX_JSON_CHARS = 50_000;
const FORM_FILL_MAX_FILE_BYTES = 64 * 1024;

type FormFieldValue = string | number | boolean | null | Array<string | number | boolean | null>;

type TargetFormFillReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  applied: Array<{
    selector: string;
    action: "fill" | "select" | "check" | "uncheck";
    valueLength: number;
  }>;
  count: number;
  submitted: boolean;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseChunkSize(value: number | undefined): number {
  const chunkSize = value ?? DEFAULT_TARGET_READ_CHUNK_SIZE;
  if (!Number.isFinite(chunkSize) || !Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > READ_MAX_CHUNK_SIZE) {
    throw new CliError("E_QUERY_INVALID", `chunk-size must be an integer between 1 and ${READ_MAX_CHUNK_SIZE}`);
  }
  return chunkSize;
}

function parseChunkIndex(value: number | undefined): number {
  const chunkIndex = value ?? 1;
  if (!Number.isFinite(chunkIndex) || !Number.isInteger(chunkIndex) || chunkIndex <= 0 || chunkIndex > READ_MAX_CHUNK_INDEX) {
    throw new CliError("E_QUERY_INVALID", `chunk must be an integer between 1 and ${READ_MAX_CHUNK_INDEX}`);
  }
  return chunkIndex;
}

function parseFormFieldValue(value: unknown): FormFieldValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (value.some((entry) => entry !== null && !["string", "number", "boolean"].includes(typeof entry))) {
      throw new CliError("E_QUERY_INVALID", "form-fill values in arrays must be scalar (string|number|boolean|null)");
    }
    return value as Array<string | number | boolean | null>;
  }

  throw new CliError("E_QUERY_INVALID", "form-fill values must be scalar or scalar arrays");
}

function parseFormJsonText(jsonText: string): Record<string, FormFieldValue> {
  if (jsonText.length > FORM_FILL_MAX_JSON_CHARS) {
    throw new CliError("E_QUERY_INVALID", `fields-json must be at most ${FORM_FILL_MAX_JSON_CHARS} characters`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new CliError("E_QUERY_INVALID", "fields-json must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("E_QUERY_INVALID", "fields-json must be a JSON object mapping selector -> value");
  }

  const entries = Object.entries(parsed as Record<string, unknown>).map(([rawSelector, rawValue]) => {
    const selector = rawSelector.trim();
    if (selector.length === 0) {
      throw new CliError("E_QUERY_INVALID", "form-fill selector keys must be non-empty");
    }
    return [selector, parseFormFieldValue(rawValue)] as const;
  });
  if (entries.length === 0) {
    throw new CliError("E_QUERY_INVALID", "form-fill requires at least one selector/value pair");
  }
  if (entries.length > FORM_FILL_MAX_FIELDS) {
    throw new CliError("E_QUERY_INVALID", `form-fill supports at most ${FORM_FILL_MAX_FIELDS} fields`);
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

function parseFormFields(opts: { fieldsJson?: string; fieldsFile?: string }): Record<string, FormFieldValue> {
  const inline = typeof opts.fieldsJson === "string" ? opts.fieldsJson.trim() : "";
  const file = typeof opts.fieldsFile === "string" ? opts.fieldsFile.trim() : "";

  const selected = Number(inline.length > 0) + Number(file.length > 0);
  if (selected !== 1) {
    throw new CliError("E_QUERY_INVALID", "Use exactly one form source: --fields-json or --fields-file");
  }

  if (inline.length > 0) {
    return parseFormJsonText(inline);
  }

  const { fs } = providers();
  let stat: { isFile(): boolean; size: number };
  try {
    stat = fs.statSync(file);
  } catch {
    throw new CliError("E_QUERY_INVALID", "fields-file is not readable");
  }
  if (!stat.isFile()) {
    throw new CliError("E_QUERY_INVALID", "fields-file must point to a file");
  }
  if (stat.size > FORM_FILL_MAX_FILE_BYTES) {
    throw new CliError("E_QUERY_INVALID", `fields-file must be at most ${FORM_FILL_MAX_FILE_BYTES} bytes`);
  }

  let fileText = "";
  try {
    fileText = fs.readFileSync(file, "utf8");
  } catch {
    throw new CliError("E_QUERY_INVALID", "fields-file is not readable");
  }
  if (fileText.trim().length === 0) {
    throw new CliError("E_QUERY_INVALID", "fields-file is empty");
  }
  return parseFormJsonText(fileText);
}

function parseBooleanInput(value: FormFieldValue): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  throw new CliError("E_QUERY_INVALID", "checkbox/radio value must be boolean-like (true|false)");
}

async function resolveFormSelectorLocator(opts: { page: { locator(selector: string): Locator }; selector: string }): Promise<Locator> {
  const locator = opts.page.locator(opts.selector);
  let count = 0;
  try {
    count = await locator.count();
  } catch {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${opts.selector}`);
  }

  if (count < 1) {
    throw new CliError("E_QUERY_INVALID", `No element matched selector: ${opts.selector}`);
  }
  return locator.first();
}

async function applyFormValue(opts: {
  locator: Locator;
  value: FormFieldValue;
  timeoutMs: number;
}): Promise<{ action: "fill" | "select" | "check" | "uncheck"; valueLength: number }> {
  const descriptor = await opts.locator.evaluate((node: any) => {
    const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
    const inputType = typeof node?.type === "string" ? node.type.toLowerCase() : "";
    return {
      tagName,
      inputType,
    };
  });

  if (descriptor.tagName === "select") {
    const rawOptions = Array.isArray(opts.value) ? opts.value : [opts.value];
    const options = rawOptions.map((entry) => (entry === null ? "" : String(entry)));
    await opts.locator.selectOption(options, {
      timeout: opts.timeoutMs,
    });
    return {
      action: "select",
      valueLength: options.join(",").length,
    };
  }

  if (descriptor.tagName === "input" && descriptor.inputType === "radio") {
    const radioValue = parseBooleanInput(opts.value);
    if (!radioValue) {
      throw new CliError("E_QUERY_INVALID", "radio inputs only support truthy values");
    }
    await opts.locator.check({
      timeout: opts.timeoutMs,
    });
    return {
      action: "check",
      valueLength: 1,
    };
  }

  if (descriptor.tagName === "input" && descriptor.inputType === "checkbox") {
    const checked = parseBooleanInput(opts.value);
    if (checked) {
      await opts.locator.check({
        timeout: opts.timeoutMs,
      });
      return {
        action: "check",
        valueLength: 1,
      };
    }
    await opts.locator.uncheck({
      timeout: opts.timeoutMs,
    });
    return {
      action: "uncheck",
      valueLength: 0,
    };
  }

  if (Array.isArray(opts.value)) {
    throw new CliError("E_QUERY_INVALID", "array values are only supported for <select> controls");
  }

  const fillValue = opts.value === null ? "" : String(opts.value);
  await opts.locator.fill(fillValue, {
    timeout: opts.timeoutMs,
  });
  return {
    action: "fill",
    valueLength: fillValue.length,
  };
}

async function extractScopedText(opts: {
  evaluator: { evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T> };
  selectorQuery: string | null;
  visibleOnly: boolean;
}): Promise<{ matched: boolean; text: string }> {
  return await opts.evaluator.evaluate(
    ({ selectorQuery, visibleOnly }: { selectorQuery: string | null; visibleOnly: boolean }) => {
      const runtime = globalThis as unknown as { document?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
      const rootNode = selectorQuery ? doc?.querySelector?.(selectorQuery) ?? null : doc?.body ?? null;
      if (!rootNode) {
        return {
          matched: false,
          text: "",
        };
      }

      const textRaw = visibleOnly ? rootNode?.innerText ?? "" : rootNode?.textContent ?? "";
      return {
        matched: true,
        text: normalize(textRaw),
      };
    },
    {
      selectorQuery: opts.selectorQuery,
      visibleOnly: opts.visibleOnly,
    },
  );
}

export async function targetRead(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  chunkSize?: number;
  chunkIndex?: number;
}): Promise<TargetReadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selectorQuery = normalizeSelectorQuery(opts.selectorQuery);
  const visibleOnly = Boolean(opts.visibleOnly);
  const frameScope = parseFrameScope(opts.frameScope);
  const chunkSize = parseChunkSize(opts.chunkSize);
  const chunkIndex = parseChunkIndex(opts.chunkIndex);

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const frames = framesForScope(target.page, frameScope);
    const hints = frameScopeHints({
      frameScope,
      frameCount: target.page.frames().length,
      command: "target.read",
      targetId: requestedTargetId,
    });
    if (selectorQuery) {
      if (frameScope === "main") {
        await ensureValidSelector(target.page, selectorQuery);
      } else {
        for (const frame of frames) {
          try {
            await frame.locator(selectorQuery).count();
          } catch {
            throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selectorQuery}`);
          }
        }
      }
    }
    const frameTexts: string[] = [];
    let scopeMatched = false;
    for (const frame of frames) {
      const scopedText = await extractScopedText({
        evaluator: frame,
        selectorQuery,
        visibleOnly,
      });
      scopeMatched = scopeMatched || scopedText.matched;
      if (scopedText.text.length > 0) {
        frameTexts.push(scopedText.text);
      }
    }
    const fullText = frameTexts.join("\n");

    const totalChars = fullText.length;
    const totalChunks = Math.max(1, Math.ceil(totalChars / chunkSize));
    if (chunkIndex > totalChunks) {
      throw new CliError("E_QUERY_INVALID", `chunk must be between 1 and ${totalChunks}`);
    }

    const start = (chunkIndex - 1) * chunkSize;
    const text = fullText.slice(start, start + chunkSize);
    const actionCompletedAt = Date.now();

    const report: TargetReadReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      url: target.page.url(),
      title: await target.page.title(),
      scope: {
        selector: selectorQuery,
        matched: scopeMatched,
        visibleOnly,
        frameScope,
      },
      chunkSize,
      chunkIndex,
      totalChunks,
      totalChars,
      text,
      truncated: chunkIndex < totalChunks,
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

export async function targetFormFill(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  fieldsJson?: string;
  fieldsFile?: string;
}): Promise<TargetFormFillReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const fields = parseFormFields({
    fieldsJson: opts.fieldsJson,
    fieldsFile: opts.fieldsFile,
  });

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const applied: TargetFormFillReport["applied"] = [];
    for (const [selector, value] of Object.entries(fields)) {
      const locator = await resolveFormSelectorLocator({
        page: target.page,
        selector,
      });
      const result = await applyFormValue({
        locator,
        value,
        timeoutMs: opts.timeoutMs,
      });
      applied.push({
        selector,
        action: result.action,
        valueLength: result.valueLength,
      });
    }
    const title = await target.page.title();
    const actionCompletedAt = Date.now();

    const report: TargetFormFillReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      applied,
      count: applied.length,
      submitted: false,
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
        url: target.page.url(),
        title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "form-fill",
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
