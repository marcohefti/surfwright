import { CliError } from "../errors.js";
import { executePipelinePlan } from "../pipeline.js";
import { resolvePipelineSessionId } from "../session-isolation.js";
import { targetClick } from "../target/target-click.js";
import { targetEval } from "../target/target-eval.js";
import { targetExtract } from "../target/target-extract.js";
import { targetFind } from "../target/target-find.js";
import { targetRead } from "../target/target-read.js";
import { targetSnapshot } from "../target/snapshot/target-snapshot.js";
import { targetWait } from "../target/target-wait.js";
import { resolveSessionForAction, targetList } from "../target/targets.js";
import type { SessionReport } from "../types.js";
import { parseManagedBrowserMode } from "./browser-mode.js";
import { openUrl } from "./open.js";

export async function runPipeline(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
  timeoutMs: number;
  sessionId?: string;
  browserModeInput?: string;
  isolation?: string;
  doctor?: boolean;
  record?: boolean;
  recordPath?: string;
  recordLabel?: string;
  ensureSharedSession: (input: { timeoutMs: number }) => Promise<SessionReport>;
}): Promise<Record<string, unknown>> {
  const sourceCount =
    Number(typeof opts.planPath === "string" && opts.planPath.length > 0) +
    Number(typeof opts.planJson === "string" && opts.planJson.length > 0) +
    Number(typeof opts.replayPath === "string" && opts.replayPath.length > 0);
  if (sourceCount !== 1) {
    throw new CliError("E_QUERY_INVALID", "Use exactly one plan source: --plan, --plan-json, or --replay");
  }
  const desiredBrowserMode = parseManagedBrowserMode(opts.browserModeInput);
  const resolvedSessionId = opts.doctor
    ? opts.sessionId
    : await resolvePipelineSessionId({
        sessionId: opts.sessionId,
        isolation: opts.isolation,
        timeoutMs: opts.timeoutMs,
        ensureSharedSession: opts.ensureSharedSession,
        ensureImplicitSession: async ({ timeoutMs }) =>
          await resolveSessionForAction({
            timeoutMs,
            allowImplicitNewSession: true,
            browserMode: desiredBrowserMode ?? undefined,
          }),
      });

  if (!opts.doctor && typeof resolvedSessionId === "string" && resolvedSessionId.length > 0 && desiredBrowserMode) {
    await resolveSessionForAction({
      sessionHint: resolvedSessionId,
      timeoutMs: opts.timeoutMs,
      allowImplicitNewSession: false,
      browserMode: desiredBrowserMode,
    });
  }

  return await executePipelinePlan({
    planPath: opts.planPath,
    planJson: opts.planJson,
    stdinPlan: opts.stdinPlan,
    replayPath: opts.replayPath,
    timeoutMs: opts.timeoutMs,
    sessionId: resolvedSessionId,
    doctor: Boolean(opts.doctor),
    record: Boolean(opts.record),
    recordPath: opts.recordPath,
    recordLabel: opts.recordLabel,
    ops: {
      open: async (input) =>
        await openUrl({
          inputUrl: input.url,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          reuseUrl: input.reuseUrl,
          isolation: opts.isolation,
          browserModeInput: opts.browserModeInput,
          ensureSharedSession: opts.ensureSharedSession,
        }),
      list: async (input) =>
        (await targetList({ timeoutMs: input.timeoutMs, sessionId: input.sessionId, persistState: input.persistState })) as unknown as Record<
          string,
          unknown
        >,
      snapshot: async (input) =>
        (await targetSnapshot({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          selectorQuery: input.selectorQuery,
          visibleOnly: input.visibleOnly,
          frameScope: input.frameScope,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      find: async (input) =>
        (await targetFind({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          textQuery: input.textQuery,
          selectorQuery: input.selectorQuery,
          containsQuery: input.containsQuery,
          visibleOnly: input.visibleOnly,
          first: input.first,
          limit: input.limit,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      click: async (input) =>
        (await targetClick({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          textQuery: input.textQuery,
          selectorQuery: input.selectorQuery,
          containsQuery: input.containsQuery,
          visibleOnly: input.visibleOnly,
          waitForText: input.waitForText,
          waitForSelector: input.waitForSelector,
          waitNetworkIdle: input.waitNetworkIdle,
          snapshot: input.snapshot,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      read: async (input) =>
        (await targetRead({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          selectorQuery: input.selectorQuery,
          visibleOnly: input.visibleOnly,
          frameScope: input.frameScope,
          chunkSize: input.chunkSize,
          chunkIndex: input.chunkIndex,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      extract: async (input) =>
        (await targetExtract({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          kind: input.kind,
          selectorQuery: input.selectorQuery,
          visibleOnly: input.visibleOnly,
          frameScope: input.frameScope,
          limit: input.limit,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      eval: async (input) =>
        (await targetEval({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          expression: input.expression,
          argJson: input.argJson,
          captureConsole: input.captureConsole,
          maxConsole: input.maxConsole,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
      wait: async (input) =>
        (await targetWait({
          targetId: input.targetId,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId,
          forText: input.forText,
          forSelector: input.forSelector,
          networkIdle: input.networkIdle,
          persistState: input.persistState,
        })) as unknown as Record<string, unknown>,
    },
  });
}
