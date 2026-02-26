import { CliError } from "../../errors.js";
import { resolvePipelineSessionId } from "../../session-isolation.js";
import { parseManagedBrowserMode } from "../../session/index.js";
import { resolveSessionForAction } from "../../target/public.js";
import type { SessionReport } from "../../types.js";
import { executePipelinePlan, loadPipelinePlan } from "../index.js";
import { buildPipelineOps } from "./run-ops.js";
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
  logNdjsonPath?: string;
  logNdjsonMode?: string;
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
  const ops = buildPipelineOps({
    isolation: opts.isolation,
    browserModeInput: opts.browserModeInput,
  });
  if (opts.doctor) {
    return await executePipelinePlan({
      timeoutMs: opts.timeoutMs,
      sessionId: opts.sessionId,
      doctor: true,
      record: Boolean(opts.record),
      recordPath: opts.recordPath,
      recordLabel: opts.recordLabel,
      logNdjsonPath: opts.logNdjsonPath,
      logNdjsonMode: opts.logNdjsonMode,
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
    logNdjsonPath: opts.logNdjsonPath,
    logNdjsonMode: opts.logNdjsonMode,
    ops,
    loaded,
    lintIssues: issues,
  });
}
