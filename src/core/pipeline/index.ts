import { CliError } from "../errors.js";
import {
  SUPPORTED_STEP_IDS,
  evaluateAssertionSpec,
  evaluateAssertions,
  lintPlan,
  parseOptionalString,
  parseStepAlias,
  parseStepTimeoutMs,
  resolvePlanSource,
  resolveTemplateInValue,
  type LoadedPlan,
  type PipelineLintIssue,
  type PipelineOps,
  type PipelineResultMap,
  type PipelineStepInput,
} from "../pipeline-support/index.js";
import { writeRunArtifact } from "../pipeline-support/index.js";
import { appendNdjsonLogLine, initNdjsonLogFile, resolveNdjsonLogPath } from "./infra/ndjson-log.js";
import { PIPELINE_STEP_EXECUTORS, countAssertionChecks, projectRunResult } from "./infra/execute-shared.js";
export type { PipelineOps, PipelineStepInput } from "../pipeline-support/index.js";

export function loadPipelinePlan(input: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
}): { loaded: LoadedPlan; issues: PipelineLintIssue[]; lintErrors: PipelineLintIssue[] } {
  const loaded = resolvePlanSource(input);
  const issues = lintPlan(loaded.plan);
  const lintErrors = issues.filter((entry) => entry.level === "error");
  return { loaded, issues, lintErrors };
}

export async function executePipelinePlan(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
  timeoutMs: number;
  sessionId?: string;
  doctor?: boolean;
  record?: boolean;
  recordPath?: string;
  recordLabel?: string;
  logNdjsonPath?: string;
  logNdjsonMode?: string;
  ops: PipelineOps;
  loaded?: LoadedPlan;
  lintIssues?: PipelineLintIssue[];
}): Promise<Record<string, unknown>> {
  const loaded =
    opts.loaded ??
    resolvePlanSource({
      planPath: opts.planPath,
      planJson: opts.planJson,
      stdinPlan: opts.stdinPlan,
      replayPath: opts.replayPath,
    });
  const lintIssues = opts.lintIssues ?? lintPlan(loaded.plan);
  const lintErrors = lintIssues.filter((entry) => entry.level === "error");
  if (opts.doctor) {
    return {
      ok: true,
      mode: "doctor",
      source: loaded.source,
      stepCount: loaded.plan.steps.length,
      resultMapFields: loaded.plan.result ? Object.keys(loaded.plan.result).length : 0,
      requireChecks: countAssertionChecks(loaded.plan.require),
      valid: lintErrors.length === 0,
      supportedSteps: [...SUPPORTED_STEP_IDS],
      issues: lintIssues,
    };
  }
  if (lintErrors.length > 0) {
    throw new CliError("E_QUERY_INVALID", `plan lint failed: ${lintErrors[0].path} ${lintErrors[0].message}`);
  }

  const startedAt = Date.now();
  const steps = loaded.plan.steps;
  const results: Array<Record<string, unknown>> = [];
  const aliases: Record<string, Record<string, unknown>> = {};
  const timeline: Array<Record<string, unknown>> = [];

  const ndjsonPathRaw =
    typeof opts.logNdjsonPath === "string" && opts.logNdjsonPath.trim().length > 0 ? opts.logNdjsonPath.trim() : null;
  const ndjsonMode = opts.logNdjsonMode === "full" ? "full" : "minimal";
  const ndjsonPath = ndjsonPathRaw ? resolveNdjsonLogPath(ndjsonPathRaw) : null;
  const emitNdjson = (event: Record<string, unknown>) => {
    if (!ndjsonPath) {
      return;
    }
    appendNdjsonLogLine(ndjsonPath, event);
  };
  if (ndjsonPath) {
    initNdjsonLogFile(ndjsonPath);
  }

  timeline.push({
    atMs: 0,
    phase: "run.start",
    source: loaded.source,
  });
  emitNdjson({ atMs: 0, phase: "run.start", source: loaded.source });
  const ctx: { sessionId?: string; targetId?: string } = {
    sessionId: opts.sessionId,
    targetId: undefined,
  };

  for (let index = 0; index < steps.length; index += 1) {
    const stepRaw = steps[index];
    const templateScope: Record<string, unknown> = {
      sessionId: ctx.sessionId ?? null,
      targetId: ctx.targetId ?? null,
      last: results.length > 0 ? (results[results.length - 1].report as Record<string, unknown>) : null,
      steps: aliases,
    };
    const step = resolveTemplateInValue(stepRaw, templateScope, `steps[${index}]`) as PipelineStepInput;
    if (!step || typeof step !== "object" || typeof step.id !== "string") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}] must include id`);
    }
    if (!SUPPORTED_STEP_IDS.has(step.id)) {
      throw new CliError("E_QUERY_INVALID", `Unsupported step id: ${step.id}`);
    }

    const stepAlias = parseStepAlias(step.as, index);
    const stepTimeoutMs = parseStepTimeoutMs(step.timeoutMs, opts.timeoutMs, index);
    const stepStartedAt = Date.now();
    const stepTargetId = parseOptionalString(step.targetId, `steps[${index}].targetId`) ?? ctx.targetId;
    const stepFrameScope = parseOptionalString(step.frameScope, `steps[${index}].frameScope`);
    timeline.push({
      atMs: stepStartedAt - startedAt,
      phase: "step.start",
      index,
      id: step.id,
      as: stepAlias,
      targetId: stepTargetId ?? null,
    });
    emitNdjson({
      atMs: stepStartedAt - startedAt,
      phase: "step.start",
      index,
      id: step.id,
      as: stepAlias ?? null,
      targetId: stepTargetId ?? null,
    });

    const stepExecutor = PIPELINE_STEP_EXECUTORS[step.id];
    if (!stepExecutor) {
      throw new CliError("E_QUERY_INVALID", `Unsupported step id: ${step.id}`);
    }
    const report = await stepExecutor({
      step,
      index,
      timeoutMs: stepTimeoutMs,
      stepTargetId,
      stepFrameScope,
      sessionId: ctx.sessionId,
      ops: opts.ops,
    });

    if (stepAlias) {
      aliases[stepAlias] = report;
    }
    if (typeof report.sessionId === "string") {
      ctx.sessionId = report.sessionId;
    }
    if (typeof report.targetId === "string") {
      ctx.targetId = report.targetId;
    }

    const assertions = evaluateAssertions(step, report);
    if (assertions.failed > 0) {
      const failed = assertions.checks.find((entry) => !entry.ok);
      timeline.push({
        atMs: Date.now() - startedAt,
        phase: "step.assert-failed",
        index,
        id: step.id,
        message: failed?.message ?? "assertion failed",
      });
      throw new CliError(
        "E_ASSERT_FAILED",
        `Assertion failed at steps[${index}] ${failed?.path ?? ""}: ${failed?.message ?? "unknown"}`.trim(),
      );
    }

    const stepEndedAt = Date.now();
    const stepEndEvent = {
      atMs: stepEndedAt - startedAt,
      phase: "step.end",
      index,
      id: step.id,
      as: stepAlias,
      elapsedMs: stepEndedAt - stepStartedAt,
      sessionId: typeof report.sessionId === "string" ? report.sessionId : null,
      targetId: typeof report.targetId === "string" ? report.targetId : null,
      assertions: assertions.total,
    };
    timeline.push(stepEndEvent);
    emitNdjson({ ...stepEndEvent, as: stepAlias ?? null });
    if (ndjsonPath && ndjsonMode === "full") {
      emitNdjson({
        atMs: stepEndedAt - startedAt,
        phase: "step.report",
        index,
        id: step.id,
        as: stepAlias ?? null,
        report,
      });
    }
    results.push({
      index,
      id: step.id,
      as: stepAlias,
      elapsedMs: stepEndedAt - stepStartedAt,
      assertions: {
        total: assertions.total,
        failed: assertions.failed,
      },
      report,
    });
  }

  const finishedAt = Date.now();
  timeline.push({
    atMs: finishedAt - startedAt,
    phase: "run.end",
    steps: results.length,
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
  });
  emitNdjson({
    atMs: finishedAt - startedAt,
    phase: "run.end",
    steps: results.length,
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
  });
  const resultScope: Record<string, unknown> = {
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
    last: results.length > 0 ? (results[results.length - 1].report as Record<string, unknown>) : null,
    steps: aliases,
  };
  const projectedResult = projectRunResult(loaded.plan.result as PipelineResultMap | undefined, resultScope);
  const requireScope: Record<string, unknown> =
    typeof projectedResult === "undefined"
      ? resultScope
      : {
          ...resultScope,
          result: projectedResult,
        };
  const resolvedRequire = resolveTemplateInValue(loaded.plan.require, requireScope, "require") as PipelineStepInput["assert"] | undefined;
  const requireAssertions = evaluateAssertionSpec(resolvedRequire, requireScope);
  if (requireAssertions.failed > 0) {
    const failed = requireAssertions.checks.find((entry) => !entry.ok);
    throw new CliError(
      "E_ASSERT_FAILED",
      `Assertion failed at require ${failed?.path ?? ""}: ${failed?.message ?? "unknown"}`.trim(),
    );
  }

  const report: Record<string, unknown> = {
    ok: true,
    source: loaded.source,
    replay: loaded.replay,
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
    steps: results,
    timeline,
    totalMs: finishedAt - startedAt,
    ...(typeof projectedResult === "undefined" ? {} : { result: projectedResult }),
    ...(typeof loaded.plan.require === "undefined" ? {} : { require: requireAssertions }),
  };
  if (ndjsonPath) {
    report.logNdjson = { path: ndjsonPath, mode: ndjsonMode };
  }
  if (opts.record) {
    report.artifact = writeRunArtifact({
      outPath: opts.recordPath,
      label: opts.recordLabel,
      source: loaded.source,
      replay: loaded.replay,
      plan: loaded.plan,
      report: {
        ok: true,
        source: loaded.source,
        replay: loaded.replay,
        sessionId: ctx.sessionId ?? null,
        targetId: ctx.targetId ?? null,
        steps: results,
        timeline,
        totalMs: finishedAt - startedAt,
        ...(typeof projectedResult === "undefined" ? {} : { result: projectedResult }),
        ...(typeof loaded.plan.require === "undefined" ? {} : { require: requireAssertions }),
      },
    });
  }
  return { ...report };
}
