import { CliError } from "../../errors.js";
import { resolvePipelineSessionId } from "../../session-isolation.js";
import { parseManagedBrowserMode } from "../../session/index.js";
import { openUrl } from "../../session/public.js";
import {
  resolveSessionForAction,
  targetClick,
  targetEval,
  targetExtract,
  targetFind,
  targetList,
  targetRead,
  targetSnapshot,
  targetWait,
} from "../../target/public.js";
import type { SessionReport } from "../../types.js";
import { executePipelinePlan, loadPipelinePlan } from "../index.js";

export async function runPipeline(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
  timeoutMs: number;
  sessionId?: string;
  profile?: string;
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
  const { loaded, issues, lintErrors } = loadPipelinePlan({
    planPath: opts.planPath,
    planJson: opts.planJson,
    stdinPlan: opts.stdinPlan,
    replayPath: opts.replayPath,
  });

  const ops = {
    open: async (input: { url: string; timeoutMs: number; sessionId?: string; reuseUrl: boolean }) =>
      (await openUrl({
        inputUrl: input.url,
        timeoutMs: input.timeoutMs,
        sessionId: input.sessionId,
        reuseUrl: input.reuseUrl,
        isolation: opts.isolation,
        browserModeInput: opts.browserModeInput,
      })) as unknown as Record<string, unknown>,
    list: async (input: { timeoutMs: number; sessionId?: string; persistState: boolean }) =>
      (await targetList({ timeoutMs: input.timeoutMs, sessionId: input.sessionId, persistState: input.persistState })) as unknown as Record<
        string,
        unknown
      >,
    snapshot: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      selectorQuery?: string;
      visibleOnly: boolean;
      frameScope?: string;
      persistState: boolean;
    }) =>
      (await targetSnapshot({
        targetId: input.targetId,
        timeoutMs: input.timeoutMs,
        sessionId: input.sessionId,
        selectorQuery: input.selectorQuery,
        visibleOnly: input.visibleOnly,
        frameScope: input.frameScope,
        persistState: input.persistState,
      })) as unknown as Record<string, unknown>,
    find: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      textQuery?: string;
      selectorQuery?: string;
      containsQuery?: string;
      visibleOnly: boolean;
      first: boolean;
      limit?: number;
      persistState: boolean;
    }) =>
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
    click: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      textQuery?: string;
      selectorQuery?: string;
      containsQuery?: string;
      visibleOnly: boolean;
      waitForText?: string;
      waitForSelector?: string;
      waitNetworkIdle: boolean;
      snapshot: boolean;
      persistState: boolean;
    }) =>
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
    read: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      selectorQuery?: string;
      visibleOnly: boolean;
      frameScope?: string;
      chunkSize?: number;
      chunkIndex?: number;
      persistState: boolean;
    }) =>
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
    extract: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      kind?: string;
      selectorQuery?: string;
      visibleOnly: boolean;
      frameScope?: string;
      limit?: number;
      persistState: boolean;
    }) =>
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
    eval: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      expression?: string;
      argJson?: string;
      captureConsole?: boolean;
      maxConsole?: number;
      persistState: boolean;
    }) =>
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
    wait: async (input: {
      targetId: string;
      timeoutMs: number;
      sessionId?: string;
      forText?: string;
      forSelector?: string;
      networkIdle: boolean;
      persistState: boolean;
    }) =>
      (await targetWait({
        targetId: input.targetId,
        timeoutMs: input.timeoutMs,
        sessionId: input.sessionId,
        forText: input.forText,
        forSelector: input.forSelector,
        networkIdle: input.networkIdle,
        persistState: input.persistState,
      })) as unknown as Record<string, unknown>,
  };

  if (opts.doctor) {
    return await executePipelinePlan({
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      doctor: true,
      record: Boolean(opts.record),
      recordPath: opts.recordPath,
      recordLabel: opts.recordLabel,
      ops,
      loaded,
      lintIssues: issues,
    });
  }

  if (lintErrors.length > 0) {
    throw new CliError("E_QUERY_INVALID", `plan lint failed: ${lintErrors[0].path} ${lintErrors[0].message}`);
  }

  if (typeof opts.profile === "string" && opts.profile.trim().length > 0 && typeof opts.sessionId === "string" && opts.sessionId.trim().length > 0) {
    throw new CliError("E_QUERY_INVALID", "Use either --session or --profile (not both)");
  }

  const resolvedSessionId =
    typeof opts.profile === "string" && opts.profile.trim().length > 0
      ? (
          await resolveSessionForAction({
            profileHint: opts.profile,
            timeoutMs: opts.timeoutMs,
            allowImplicitNewSession: false,
            browserMode: desiredBrowserMode ?? undefined,
          })
        ).session.sessionId
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
    timeoutMs: opts.timeoutMs,
    sessionId: resolvedSessionId,
    doctor: Boolean(opts.doctor),
    record: Boolean(opts.record),
    recordPath: opts.recordPath,
    recordLabel: opts.recordLabel,
    ops,
    loaded,
    lintIssues: issues,
  });
}
