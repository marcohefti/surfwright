import { chromium, type CDPSession } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { providers } from "../../providers/index.js";
import { createCdpMainWorldEvaluator, getCdpFrameTree, openCdpSession, resolveCdpFrameByStableId } from "./cdp/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { safePageTitle } from "./utils/safe-page-title.js";
import { parseEvalExpression } from "./utils/eval-expression.js";
import type { TargetEvalReport } from "../../types.js";
type TargetCloseReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  closed: true;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};
// Inline expressions are argv-bound and should stay small/deterministic.
const EVAL_MAX_INLINE_EXPRESSION_CHARS = 4096;
// File-based scripts avoid shell argv constraints but still need bounded input.
const EVAL_MAX_SCRIPT_FILE_BYTES = 64 * 1024;
const EVAL_MAX_ARG_JSON_CHARS = 20000;
const EVAL_MAX_CONSOLE = 100;
const EVAL_MAX_CONSOLE_TEXT_CHARS = 4000;
const EVAL_MAX_RESULT_STRING_CHARS = 4000;
const EVAL_MAX_RESULT_ITEMS = 200;
const EVAL_MAX_RESULT_DEPTH = 6;

export function parseJsonObjectText(opts: {
  text: string;
  maxChars: number;
  tooLargeMessage: string;
  invalidMessage: string;
  objectMessage: string;
}): Record<string, unknown> {
  if (opts.text.length > opts.maxChars) {
    throw new CliError("E_QUERY_INVALID", opts.tooLargeMessage);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.text);
  } catch {
    throw new CliError("E_QUERY_INVALID", opts.invalidMessage);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("E_QUERY_INVALID", opts.objectMessage);
  }
  return parsed as Record<string, unknown>;
}

function parseArgJson(input: string | undefined): unknown {
  if (typeof input !== "string") {
    return null;
  }
  if (input.length > EVAL_MAX_ARG_JSON_CHARS) {
    throw new CliError("E_QUERY_INVALID", `arg-json must be at most ${EVAL_MAX_ARG_JSON_CHARS} characters`);
  }
  try {
    return JSON.parse(input);
  } catch {
    throw new CliError("E_QUERY_INVALID", "arg-json must be valid JSON");
  }
}
function parseMaxConsole(value: number | undefined): number {
  const maxConsole = value ?? 20;
  if (!Number.isFinite(maxConsole) || !Number.isInteger(maxConsole) || maxConsole <= 0 || maxConsole > EVAL_MAX_CONSOLE) {
    throw new CliError("E_QUERY_INVALID", `max-console must be an integer between 1 and ${EVAL_MAX_CONSOLE}`);
  }
  return maxConsole;
}
async function runWithTimeout<T>(opts: {
  promise: Promise<T>;
  timeoutMs: number;
  onTimeout?: () => Promise<void> | void;
}): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      opts.promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          Promise.resolve(opts.onTimeout?.()).catch(() => {});
          reject(new CliError("E_EVAL_TIMEOUT", "evaluation did not complete before timeout"));
        }, opts.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
function normalizeEvalFailure(error: unknown): never {
  if (error instanceof CliError) {
    throw error;
  }
  if (error instanceof Error) {
    const message = error.message || "evaluation failed";
    const lower = message.toLowerCase();
    if (lower.includes("unserializable") || lower.includes("cyclic")) {
      throw new CliError("E_EVAL_RESULT_UNSERIALIZABLE", "evaluation result is not JSON-serializable");
    }
    throw new CliError("E_EVAL_RUNTIME", message);
  }
  throw new CliError("E_EVAL_RUNTIME", "evaluation failed");
}

async function recoverTimedOutEvaluation(opts: {
  cdp: Pick<CDPSession, "send">;
}): Promise<void> {
  // Best-effort guardrail: terminate active execution and stop in-flight loads before disconnect.
  await opts.cdp.send("Runtime.terminateExecution").catch(() => {});
  await opts.cdp.send("Page.stopLoading").catch(() => {});
}

export async function targetEval(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  expression?: string;
  expr?: string;
  scriptFile?: string;
  mode?: "expr" | "script";
  argJson?: string;
  captureConsole?: boolean;
  maxConsole?: number;
  frameId?: string;
}): Promise<TargetEvalReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseEvalExpression(
    {
      expression: opts.expression,
      expr: opts.expr,
      scriptFile: opts.scriptFile,
      mode: opts.mode,
    },
    {
      maxInlineChars: EVAL_MAX_INLINE_EXPRESSION_CHARS,
      maxScriptFileBytes: EVAL_MAX_SCRIPT_FILE_BYTES,
    },
  );
  const arg = parseArgJson(opts.argJson);
  const captureConsole = Boolean(opts.captureConsole);
  const maxConsole = parseMaxConsole(opts.maxConsole);
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
    const worldCache = new Map<string, number>();
    const cdp = await openCdpSession(target.page, { mainWorldCache: worldCache });
    const frameTree = await getCdpFrameTree(cdp);
    const frameSelection = resolveCdpFrameByStableId({
      frameTree,
      stableFrameIdInput: typeof opts.frameId === "string" && opts.frameId.trim().length > 0 ? opts.frameId : "f-0",
    });
    const evaluator = createCdpMainWorldEvaluator({
      cdp,
      frameCdpId: frameSelection.entry.cdpFrameId,
      mainWorldCache: worldCache,
      timeoutMs: opts.timeoutMs,
    });
    const consoleEntries: TargetEvalReport["console"]["entries"] = [];
    let consoleCount = 0;
    let consoleTruncated = false;
    const consoleListener = (message: { type(): string; text(): string }) => {
      consoleCount += 1;
      if (consoleEntries.length >= maxConsole) {
        consoleTruncated = true;
        return;
      }
      const rawText = message.text();
      const text = rawText.length > EVAL_MAX_CONSOLE_TEXT_CHARS ? rawText.slice(0, EVAL_MAX_CONSOLE_TEXT_CHARS) : rawText;
      if (rawText.length > EVAL_MAX_CONSOLE_TEXT_CHARS) {
        consoleTruncated = true;
      }
      consoleEntries.push({
        level: message.type(),
        text,
      });
    };
    if (captureConsole) {
      target.page.on("console", consoleListener as never);
    }
    let evaluationPayload: {
      ok: boolean;
      errorMessage?: string;
      result?: TargetEvalReport["result"];
    };
    let didTimeout = false;
    try {
      evaluationPayload = await runWithTimeout({
        promise: evaluator.evaluate(
          async ({
            expression,
            arg,
            maxStringChars,
            maxItems,
            maxDepth,
          }: {
            expression: string;
            arg: unknown;
            maxStringChars: number;
            maxItems: number;
            maxDepth: number;
          }) => {
            const typeOf = (value: unknown): TargetEvalReport["result"]["type"] => {
              if (value === undefined) {
                return "undefined";
              }
              if (value === null) {
                return "null";
              }
              if (Array.isArray(value)) {
                return "array";
              }
              if (typeof value === "object") {
                return "object";
              }
              if (typeof value === "bigint") {
                return "bigint";
              }
              return typeof value as "boolean" | "number" | "string";
            };

            const project = (
              value: unknown,
              depth: number,
              seen: WeakSet<object>,
            ): {
              value: unknown;
              truncated: boolean;
            } => {
              if (value === undefined) {
                return { value: null, truncated: false };
              }
              if (value === null || typeof value === "boolean" || typeof value === "number") {
                return { value, truncated: false };
              }
              if (typeof value === "string") {
                if (value.length > maxStringChars) {
                  return {
                    value: value.slice(0, maxStringChars),
                    truncated: true,
                  };
                }
                return { value, truncated: false };
              }
              if (typeof value === "bigint") {
                const asString = value.toString();
                if (asString.length > maxStringChars) {
                  return {
                    value: asString.slice(0, maxStringChars),
                    truncated: true,
                  };
                }
                return {
                  value: asString,
                  truncated: false,
                };
              }
              if (typeof value === "symbol" || typeof value === "function") {
                throw new Error("unserializable");
              }
              if (depth >= maxDepth) {
                return {
                  value: "[depth-limit]",
                  truncated: true,
                };
              }

              if (Array.isArray(value)) {
                if (seen.has(value)) {
                  throw new Error("cyclic");
                }
                seen.add(value);
                const out: unknown[] = [];
                let truncated = value.length > maxItems;
                const limit = Math.min(value.length, maxItems);
                for (let idx = 0; idx < limit; idx += 1) {
                  const projected = project(value[idx], depth + 1, seen);
                  out.push(projected.value);
                  truncated = truncated || projected.truncated;
                }
                seen.delete(value);
                return { value: out, truncated };
              }

              const objectValue = value as Record<string, unknown>;
              if (seen.has(objectValue)) {
                throw new Error("cyclic");
              }
              seen.add(objectValue);
              const out: Record<string, unknown> = {};
              const keys = Object.keys(objectValue).sort();
              let truncated = keys.length > maxItems;
              const limit = Math.min(keys.length, maxItems);
              for (let idx = 0; idx < limit; idx += 1) {
                const key = keys[idx];
                const projected = project(objectValue[key], depth + 1, seen);
                out[key] = projected.value;
                truncated = truncated || projected.truncated;
              }
              seen.delete(objectValue);
              return { value: out, truncated };
            };

            try {
              const evaluator = new Function("arg", expression) as (arg: unknown) => unknown;
              const raw = evaluator(arg);
              const settled = raw && typeof (raw as Promise<unknown>).then === "function" ? await (raw as Promise<unknown>) : raw;
              const projected = project(settled, 0, new WeakSet<object>());
              return {
                ok: true,
                result: {
                  type: typeOf(settled),
                  value: projected.value,
                  truncated: projected.truncated,
                },
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                ok: false,
                errorMessage,
              };
            }
          },
          {
            expression: parsed.evaluatorBody,
            arg,
            maxStringChars: EVAL_MAX_RESULT_STRING_CHARS,
            maxItems: EVAL_MAX_RESULT_ITEMS,
            maxDepth: EVAL_MAX_RESULT_DEPTH,
          },
        ),
        timeoutMs: opts.timeoutMs,
        onTimeout: async () => {
          didTimeout = true;
          await recoverTimedOutEvaluation({ cdp });
        },
      });
    } catch (error) {
      if (didTimeout) {
        await recoverTimedOutEvaluation({ cdp });
      }
      normalizeEvalFailure(error);
    } finally {
      if (captureConsole) {
        target.page.off("console", consoleListener as never);
      }
    }
    if (!evaluationPayload.ok) {
      const message = (evaluationPayload.errorMessage ?? "").toLowerCase();
      if (message.includes("unserializable") || message.includes("cyclic")) {
        throw new CliError("E_EVAL_RESULT_UNSERIALIZABLE", "evaluation result is not JSON-serializable");
      }
      throw new CliError("E_EVAL_RUNTIME", evaluationPayload.errorMessage ?? "evaluation failed");
    }

    const actionCompletedAt = Date.now();
    const report: TargetEvalReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      expression: parsed.expression,
      context: {
        frameCount: frameSelection.frameCount,
        evaluatedFrameId: frameSelection.entry.frameId,
        evaluatedFrameUrl: frameSelection.entry.url,
        sameOrigin: frameSelection.entry.sameOrigin,
        world: "main",
      },
      result: evaluationPayload.result ?? {
        type: "undefined",
        value: null,
        truncated: false,
      },
      console: {
        captured: captureConsole,
        count: captureConsole ? consoleCount : 0,
        truncated: captureConsole ? consoleTruncated : false,
        entries: captureConsole ? consoleEntries : [],
      },
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
      const title = await safePageTitle(target.page, opts.timeoutMs);
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: target.page.url(),
        title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "eval",
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

export async function targetClose(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
}): Promise<TargetCloseReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);

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
    await target.page.close({
      runBeforeUnload: false,
    });
    const actionCompletedAt = Date.now();

    const report: TargetCloseReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      closed: true,
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
      // Close is runtime-scoped; stale target metadata is cleaned by target/session maintenance.
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
