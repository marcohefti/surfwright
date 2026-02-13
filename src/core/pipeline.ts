import { CliError } from "./errors.js";
import { writeRunArtifact } from "./pipeline-support/artifacts.js";
import {
  SUPPORTED_STEP_IDS,
  evaluateAssertions,
  lintPlan,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalString,
  parseStepAlias,
  parseStepTimeoutMs,
  resolvePlanSource,
  resolveTemplateInValue,
  type PipelineOps,
  type PipelineStepInput,
} from "./pipeline-support/plan.js";

export type { PipelineOps, PipelineStepInput } from "./pipeline-support/plan.js";

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
  ops: PipelineOps;
}): Promise<Record<string, unknown>> {
  const loaded = resolvePlanSource({
    planPath: opts.planPath,
    planJson: opts.planJson,
    stdinPlan: opts.stdinPlan,
    replayPath: opts.replayPath,
  });
  const lintIssues = lintPlan(loaded.plan);
  const lintErrors = lintIssues.filter((entry) => entry.level === "error");
  if (opts.doctor) {
    return {
      ok: true,
      mode: "doctor",
      source: loaded.source,
      stepCount: loaded.plan.steps.length,
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
  timeline.push({
    atMs: 0,
    phase: "run.start",
    source: loaded.source,
  });
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

    let report: Record<string, unknown>;
    switch (step.id) {
      case "open": {
        const url = parseOptionalString(step.url, `steps[${index}].url`);
        if (typeof url !== "string" || url.length === 0) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}].url is required for open`);
        }
        report = await opts.ops.open({
          url,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          reuseUrl: Boolean(step.reuseUrl),
        });
        break;
      }
      case "list": {
        report = await opts.ops.list({
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "snapshot": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.snapshot({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
          visibleOnly: Boolean(step.visibleOnly),
          frameScope: stepFrameScope,
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "find": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.find({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          textQuery: parseOptionalString(step.text, `steps[${index}].text`),
          selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
          containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
          visibleOnly: Boolean(step.visibleOnly),
          first: Boolean(step.first),
          limit: parseOptionalInteger(step.limit, `steps[${index}].limit`),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "click": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.click({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          textQuery: parseOptionalString(step.text, `steps[${index}].text`),
          selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
          containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
          visibleOnly: Boolean(step.visibleOnly),
          waitForText: parseOptionalString(step.waitForText, `steps[${index}].waitForText`),
          waitForSelector: parseOptionalString(step.waitForSelector, `steps[${index}].waitForSelector`),
          waitNetworkIdle: Boolean(step.waitNetworkIdle),
          snapshot: Boolean(step.snapshot),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "read": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.read({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
          visibleOnly: Boolean(step.visibleOnly),
          frameScope: stepFrameScope,
          chunkSize: parseOptionalInteger(step.chunkSize, `steps[${index}].chunkSize`),
          chunkIndex: parseOptionalInteger(step.chunk, `steps[${index}].chunk`),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "wait": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.wait({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          forText: parseOptionalString(step.forText, `steps[${index}].forText`),
          forSelector: parseOptionalString(step.forSelector, `steps[${index}].forSelector`),
          networkIdle: Boolean(step.networkIdle),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "eval": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.eval({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          expression: parseOptionalString(step.expression, `steps[${index}].expression`),
          argJson: parseOptionalString(step.argJson, `steps[${index}].argJson`),
          captureConsole: parseOptionalBoolean(step.captureConsole, `steps[${index}].captureConsole`),
          maxConsole: parseOptionalInteger(step.maxConsole, `steps[${index}].maxConsole`),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      case "extract": {
        if (!stepTargetId) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}] requires targetId (or previous step must set one)`);
        }
        report = await opts.ops.extract({
          targetId: stepTargetId,
          timeoutMs: stepTimeoutMs,
          sessionId: ctx.sessionId,
          kind: parseOptionalString(step.kind, `steps[${index}].kind`),
          selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
          visibleOnly: Boolean(step.visibleOnly),
          frameScope: stepFrameScope,
          limit: parseOptionalInteger(step.limit, `steps[${index}].limit`),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      default:
        throw new CliError("E_QUERY_INVALID", `Unsupported step id: ${step.id}`);
    }

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
    timeline.push({
      atMs: stepEndedAt - startedAt,
      phase: "step.end",
      index,
      id: step.id,
      as: stepAlias,
      elapsedMs: stepEndedAt - stepStartedAt,
      sessionId: typeof report.sessionId === "string" ? report.sessionId : null,
      targetId: typeof report.targetId === "string" ? report.targetId : null,
      assertions: assertions.total,
    });
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

  const report: Record<string, unknown> = {
    ok: true,
    source: loaded.source,
    replay: loaded.replay,
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
    steps: results,
    timeline,
    totalMs: finishedAt - startedAt,
  };
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
      },
    });
  }
  return { ...report };
}
