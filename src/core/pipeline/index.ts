import { isDeepStrictEqual } from "node:util";
import { CliError } from "../errors.js";
import {
  SUPPORTED_STEP_IDS,
  evaluateAssertions,
  lintPlan,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalString,
  parseOptionalStringOrStringArray,
  parseStepAlias,
  parseStepTimeoutMs,
  readPathValue,
  resolvePlanSource,
  resolveTemplateInValue,
  type LoadedPlan,
  type PipelineLintIssue,
  type PipelineOps,
  type PipelineStepInput,
} from "../pipeline-support/index.js";
import { writeRunArtifact } from "../pipeline-support/index.js";
import { appendNdjsonLogLine, initNdjsonLogFile, resolveNdjsonLogPath } from "./infra/ndjson-log.js";
import { parseClickIndexFromStep, requireStepTargetId } from "./infra/step-parse.js";
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

type PipelineStepExecutorInput = {
  step: PipelineStepInput;
  index: number;
  timeoutMs: number;
  stepTargetId: string | undefined;
  stepFrameScope: string | undefined;
  sessionId: string | undefined;
  ops: PipelineOps;
};

const REPEAT_UNTIL_DEFAULT_ATTEMPTS = 5;
const REPEAT_UNTIL_MAX_ATTEMPTS = 25;

const PIPELINE_STEP_EXECUTORS: Record<string, (input: PipelineStepExecutorInput) => Promise<Record<string, unknown>>> = {
  open: async ({ step, index, timeoutMs, sessionId, ops }) => {
    const url = parseOptionalString(step.url, `steps[${index}].url`);
    if (typeof url !== "string" || url.length === 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].url is required for open`);
    }
    return await ops.open({
      url,
      timeoutMs,
      sessionId,
      reuseModeInput: parseOptionalString(step.reuse, `steps[${index}].reuse`),
    });
  },
  list: async ({ step, timeoutMs, sessionId, ops }) =>
    await ops.list({
      timeoutMs,
      sessionId,
      persistState: !Boolean(step.noPersist),
    }),
  snapshot: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) =>
    await ops.snapshot({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      persistState: !Boolean(step.noPersist),
    }),
  find: async ({ step, index, timeoutMs, stepTargetId, sessionId, ops }) =>
    await ops.find({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      textQuery: parseOptionalString(step.text, `steps[${index}].text`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
      visibleOnly: Boolean(step.visibleOnly),
      first: Boolean(step.first),
      limit: parseOptionalInteger(step.limit, `steps[${index}].limit`),
      persistState: !Boolean(step.noPersist),
    }),
  count: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) =>
    await ops.count({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      textQuery: parseOptionalString(step.text, `steps[${index}].text`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      persistState: !Boolean(step.noPersist),
    }),
  "scroll-plan": async ({ step, index, timeoutMs, stepTargetId, sessionId, ops }) =>
    await ops.scrollPlan({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      stepsCsv: parseOptionalString(step.steps, `steps[${index}].steps`),
      settleMs: parseOptionalInteger(step.settleMs, `steps[${index}].settleMs`),
      countSelectorQuery: parseOptionalString(step.countSelector, `steps[${index}].countSelector`),
      countContainsQuery: parseOptionalString(step.countContains, `steps[${index}].countContains`),
      countVisibleOnly: Boolean(step.countVisibleOnly),
      persistState: !Boolean(step.noPersist),
    }),
  scrollPlan: async (input) => await PIPELINE_STEP_EXECUTORS["scroll-plan"](input),
  "repeat-until": async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) => {
    const nestedInput = step.step;
    if (!nestedInput || typeof nestedInput !== "object" || Array.isArray(nestedInput)) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step must be an object`);
    }
    const nestedStep = nestedInput as PipelineStepInput;
    if (typeof nestedStep.id !== "string" || nestedStep.id.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step.id is required`);
    }
    if (!SUPPORTED_STEP_IDS.has(nestedStep.id)) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step.id unsupported: ${nestedStep.id}`);
    }
    if (nestedStep.id === "repeat-until" || nestedStep.id === "repeatUntil") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step.id nested repeat-until is not supported`);
    }
    if (typeof nestedStep.as !== "undefined") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step.as is not supported; use steps[${index}].as`);
    }

    const untilPath = parseOptionalString(step.untilPath, `steps[${index}].untilPath`);
    if (typeof untilPath !== "string" || untilPath.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].untilPath is required`);
    }
    const hasUntilEquals = Object.prototype.hasOwnProperty.call(step, "untilEquals");
    const hasUntilGte = Object.prototype.hasOwnProperty.call(step, "untilGte");
    const untilChanged = parseOptionalBoolean(step.untilChanged, `steps[${index}].untilChanged`);
    const hasUntilChanged = untilChanged === true;
    const conditionCount = Number(hasUntilEquals) + Number(hasUntilGte) + Number(hasUntilChanged);
    if (conditionCount !== 1) {
      throw new CliError(
        "E_QUERY_INVALID",
        `steps[${index}] repeat-until requires exactly one condition: untilEquals, untilGte, or untilChanged=true`,
      );
    }

    const untilGte = hasUntilGte ? parseOptionalInteger(step.untilGte, `steps[${index}].untilGte`) : undefined;
    if (hasUntilGte && typeof untilGte !== "number") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].untilGte must be an integer`);
    }

    const maxAttemptsRaw = parseOptionalInteger(step.maxAttempts, `steps[${index}].maxAttempts`);
    const maxAttempts = maxAttemptsRaw ?? REPEAT_UNTIL_DEFAULT_ATTEMPTS;
    if (maxAttempts < 1 || maxAttempts > REPEAT_UNTIL_MAX_ATTEMPTS) {
      throw new CliError(
        "E_QUERY_INVALID",
        `steps[${index}].maxAttempts must be between 1 and ${REPEAT_UNTIL_MAX_ATTEMPTS}`,
      );
    }

    const nestedExecutor = PIPELINE_STEP_EXECUTORS[nestedStep.id];
    if (!nestedExecutor) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].step.id unsupported: ${nestedStep.id}`);
    }

    let currentSessionId = sessionId;
    let currentTargetId = stepTargetId;
    let previousValue: unknown = undefined;
    let satisfied = false;
    let lastReport: Record<string, unknown> | null = null;
    const attempts: Array<Record<string, unknown>> = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const nestedTimeoutMs = parseStepTimeoutMs(
        nestedStep.timeoutMs,
        timeoutMs,
        index,
      );
      const nestedStepTargetId = parseOptionalString(nestedStep.targetId, `steps[${index}].step.targetId`) ?? currentTargetId;
      const nestedStepFrameScope = parseOptionalString(nestedStep.frameScope, `steps[${index}].step.frameScope`) ?? stepFrameScope;
      const nestedReport = await nestedExecutor({
        step: nestedStep,
        index,
        timeoutMs: nestedTimeoutMs,
        stepTargetId: nestedStepTargetId,
        stepFrameScope: nestedStepFrameScope,
        sessionId: currentSessionId,
        ops,
      });

      if (typeof nestedReport.sessionId === "string") {
        currentSessionId = nestedReport.sessionId;
      }
      if (typeof nestedReport.targetId === "string") {
        currentTargetId = nestedReport.targetId;
      }

      const nestedAssertions = evaluateAssertions(nestedStep, nestedReport);
      if (nestedAssertions.failed > 0) {
        const failed = nestedAssertions.checks.find((entry) => !entry.ok);
        throw new CliError(
          "E_ASSERT_FAILED",
          `Assertion failed at steps[${index}].step ${failed?.path ?? ""}: ${failed?.message ?? "unknown"}`.trim(),
        );
      }

      const currentValue = readPathValue(nestedReport, untilPath);
      let matched = false;
      if (hasUntilEquals) {
        matched = isDeepStrictEqual(currentValue, step.untilEquals);
      } else if (hasUntilGte) {
        matched = typeof currentValue === "number" && typeof untilGte === "number" && currentValue >= untilGte;
      } else if (hasUntilChanged) {
        matched = attempt > 1 && !isDeepStrictEqual(currentValue, previousValue);
      }

      attempts.push({
        attempt,
        matched,
        value: typeof currentValue === "undefined" ? null : currentValue,
      });
      previousValue = currentValue;
      lastReport = nestedReport;
      if (matched) {
        satisfied = true;
        break;
      }
    }

    const until =
      hasUntilEquals
        ? { kind: "equals", path: untilPath, expected: step.untilEquals }
        : hasUntilGte
          ? { kind: "gte", path: untilPath, threshold: untilGte ?? null }
          : { kind: "changed", path: untilPath };

    return {
      ok: true,
      sessionId: currentSessionId ?? null,
      targetId: currentTargetId ?? null,
      repeat: {
        maxAttempts,
        attemptsRun: attempts.length,
        satisfied,
        until,
      },
      attempts,
      last: lastReport,
    };
  },
  repeatUntil: async (input) => await PIPELINE_STEP_EXECUTORS["repeat-until"](input),
  click: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) => {
    const expectCountAfter = parseOptionalInteger(step.expectCountAfter, `steps[${index}].expectCountAfter`);
    if (typeof expectCountAfter === "number" && expectCountAfter < 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].expectCountAfter must be a non-negative integer`);
    }
    return await ops.click({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      textQuery: parseOptionalString(step.text, `steps[${index}].text`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
      visibleOnly: Boolean(step.visibleOnly),
      withinSelector: parseOptionalString(step.within, `steps[${index}].within`),
      frameScope: stepFrameScope,
      index: parseClickIndexFromStep(step, index),
      waitForText: parseOptionalString(step.waitForText, `steps[${index}].waitForText`),
      waitForSelector: parseOptionalString(step.waitForSelector, `steps[${index}].waitForSelector`),
      waitNetworkIdle: Boolean(step.waitNetworkIdle),
      waitTimeoutMs: parseOptionalInteger(step.waitTimeoutMs, `steps[${index}].waitTimeoutMs`),
      snapshot: Boolean(step.snapshot),
      delta: Boolean(step.delta),
      proof: Boolean(step.proof),
      countAfter: Boolean(step.countAfter) || typeof expectCountAfter === "number",
      expectCountAfter,
      proofCheckState: Boolean(step.proofCheckState),
      assertUrlPrefix: parseOptionalString(step.assertUrlPrefix, `steps[${index}].assertUrlPrefix`),
      assertSelector: parseOptionalString(step.assertSelector, `steps[${index}].assertSelector`),
      assertText: parseOptionalString(step.assertText, `steps[${index}].assertText`),
      persistState: !Boolean(step.noPersist),
    });
  },
  "click-read": async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) =>
    await ops.clickRead({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      textQuery: parseOptionalString(step.text, `steps[${index}].text`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      index: parseOptionalInteger(step.index, `steps[${index}].index`),
      waitForText: parseOptionalString(step.waitForText, `steps[${index}].waitForText`),
      waitForSelector: parseOptionalString(step.waitForSelector, `steps[${index}].waitForSelector`),
      waitNetworkIdle: Boolean(step.waitNetworkIdle),
      waitTimeoutMs: parseOptionalInteger(step.waitTimeoutMs, `steps[${index}].waitTimeoutMs`),
      readSelector: parseOptionalString(step.readSelector, `steps[${index}].readSelector`),
      readVisibleOnly: Boolean(step.readVisibleOnly),
      readFrameScope: parseOptionalString(step.readFrameScope, `steps[${index}].readFrameScope`),
      chunkSize: parseOptionalInteger(step.chunkSize, `steps[${index}].chunkSize`),
      chunkIndex: parseOptionalInteger(step.chunk, `steps[${index}].chunk`),
      persistState: !Boolean(step.noPersist),
    }),
  clickRead: async (input) => await PIPELINE_STEP_EXECUTORS["click-read"](input),
  fill: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) => {
    const value = parseOptionalString(step.value, `steps[${index}].value`);
    if (typeof value !== "string") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].value is required for fill`);
    }
    return await ops.fill({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      textQuery: parseOptionalString(step.text, `steps[${index}].text`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      containsQuery: parseOptionalString(step.contains, `steps[${index}].contains`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      value,
      eventsInput: parseOptionalString(step.events, `steps[${index}].events`),
      eventModeInput: parseOptionalString(step.eventMode, `steps[${index}].eventMode`),
      waitForText: parseOptionalString(step.waitForText, `steps[${index}].waitForText`),
      waitForSelector: parseOptionalString(step.waitForSelector, `steps[${index}].waitForSelector`),
      waitNetworkIdle: Boolean(step.waitNetworkIdle),
      waitTimeoutMs: parseOptionalInteger(step.waitTimeoutMs, `steps[${index}].waitTimeoutMs`),
      proof: Boolean(step.proof),
      assertUrlPrefix: parseOptionalString(step.assertUrlPrefix, `steps[${index}].assertUrlPrefix`),
      assertSelector: parseOptionalString(step.assertSelector, `steps[${index}].assertSelector`),
      assertText: parseOptionalString(step.assertText, `steps[${index}].assertText`),
      persistState: !Boolean(step.noPersist),
    });
  },
  upload: async ({ step, index, timeoutMs, stepTargetId, sessionId, ops }) => {
    const selectorQuery = parseOptionalString(step.selector, `steps[${index}].selector`);
    if (typeof selectorQuery !== "string" || selectorQuery.length === 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].selector is required for upload`);
    }
    const filesInput = typeof step.files !== "undefined" ? step.files : step.file;
    const files = parseOptionalStringOrStringArray(filesInput, `steps[${index}].files`);
    if (!files || files.length < 1) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].files (or file) must include at least one path`);
    }
    return await ops.upload({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      selectorQuery,
      files,
      submitSelector: parseOptionalString(step.submitSelector, `steps[${index}].submitSelector`),
      expectUploadedFilename: parseOptionalString(step.expectUploadedFilename, `steps[${index}].expectUploadedFilename`),
      waitForResult: Boolean(step.waitForResult),
      resultSelector: parseOptionalString(step.resultSelector, `steps[${index}].resultSelector`),
      resultTextContains: parseOptionalString(step.resultTextContains, `steps[${index}].resultTextContains`),
      resultFilenameRegex: parseOptionalString(step.resultFilenameRegex, `steps[${index}].resultFilenameRegex`),
      waitForText: parseOptionalString(step.waitForText, `steps[${index}].waitForText`),
      waitForSelector: parseOptionalString(step.waitForSelector, `steps[${index}].waitForSelector`),
      waitNetworkIdle: Boolean(step.waitNetworkIdle),
      waitTimeoutMs: parseOptionalInteger(step.waitTimeoutMs, `steps[${index}].waitTimeoutMs`),
      proof: Boolean(step.proof),
      assertUrlPrefix: parseOptionalString(step.assertUrlPrefix, `steps[${index}].assertUrlPrefix`),
      assertSelector: parseOptionalString(step.assertSelector, `steps[${index}].assertSelector`),
      assertText: parseOptionalString(step.assertText, `steps[${index}].assertText`),
      persistState: !Boolean(step.noPersist),
    });
  },
  read: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) =>
    await ops.read({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      chunkSize: parseOptionalInteger(step.chunkSize, `steps[${index}].chunkSize`),
      chunkIndex: parseOptionalInteger(step.chunk, `steps[${index}].chunk`),
      persistState: !Boolean(step.noPersist),
    }),
  wait: async ({ step, index, timeoutMs, stepTargetId, sessionId, ops }) =>
    await ops.wait({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      forText: parseOptionalString(step.forText, `steps[${index}].forText`),
      forSelector: parseOptionalString(step.forSelector, `steps[${index}].forSelector`),
      networkIdle: Boolean(step.networkIdle),
      persistState: !Boolean(step.noPersist),
    }),
  eval: async ({ step, index, timeoutMs, stepTargetId, sessionId, ops }) =>
    await ops.eval({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      expression: parseOptionalString(step.expression, `steps[${index}].expression`),
      argJson: parseOptionalString(step.argJson, `steps[${index}].argJson`),
      captureConsole: parseOptionalBoolean(step.captureConsole, `steps[${index}].captureConsole`),
      maxConsole: parseOptionalInteger(step.maxConsole, `steps[${index}].maxConsole`),
      persistState: !Boolean(step.noPersist),
    }),
  extract: async ({ step, index, timeoutMs, stepTargetId, stepFrameScope, sessionId, ops }) =>
    await ops.extract({
      targetId: requireStepTargetId(stepTargetId, index),
      timeoutMs,
      sessionId,
      kind: parseOptionalString(step.kind, `steps[${index}].kind`),
      selectorQuery: parseOptionalString(step.selector, `steps[${index}].selector`),
      visibleOnly: Boolean(step.visibleOnly),
      frameScope: stepFrameScope,
      limit: parseOptionalInteger(step.limit, `steps[${index}].limit`),
      persistState: !Boolean(step.noPersist),
    }),
};

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
      },
    });
  }
  return { ...report };
}
