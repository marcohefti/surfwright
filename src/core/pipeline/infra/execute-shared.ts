import { isDeepStrictEqual } from "node:util";
import { CliError } from "../../errors.js";
import {
  SUPPORTED_STEP_IDS,
  evaluateAssertions,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalString,
  parseOptionalStringOrStringArray,
  parseStepTimeoutMs,
  readPathValue,
  type PipelineOps,
  type PipelineResultMap,
  type PipelineStepInput,
} from "../../pipeline-support/index.js";
import { parseClickIndexFromStep, requireStepTargetId } from "./step-parse.js";

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

export function countAssertionChecks(input: PipelineStepInput["assert"] | undefined): number {
  if (!input || typeof input !== "object") {
    return 0;
  }
  const equalsCount =
    typeof input.equals === "object" && input.equals !== null ? Object.keys(input.equals).length : 0;
  const containsCount =
    typeof input.contains === "object" && input.contains !== null ? Object.keys(input.contains).length : 0;
  const gteCount = typeof input.gte === "object" && input.gte !== null ? Object.keys(input.gte).length : 0;
  const truthyCount = Array.isArray(input.truthy) ? input.truthy.filter((entry) => typeof entry === "string").length : 0;
  const existsCount = Array.isArray(input.exists) ? input.exists.filter((entry) => typeof entry === "string").length : 0;
  return equalsCount + containsCount + gteCount + truthyCount + existsCount;
}

export function projectRunResult(resultMap: PipelineResultMap | undefined, scope: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof resultMap === "undefined") {
    return undefined;
  }
  const projected: Record<string, unknown> = {};
  for (const [key, pathExpr] of Object.entries(resultMap)) {
    if (typeof pathExpr !== "string" || pathExpr.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", `plan.result.${key} must be a non-empty string path`);
    }
    const resolved = readPathValue(scope, pathExpr);
    if (typeof resolved === "undefined") {
      throw new CliError("E_QUERY_INVALID", `plan.result.${key} unresolved path: ${pathExpr}`);
    }
    projected[key] = resolved;
  }
  return projected;
}

export const PIPELINE_STEP_EXECUTORS: Record<string, (input: PipelineStepExecutorInput) => Promise<Record<string, unknown>>> = {
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
      modeInput: parseOptionalString(step.scrollMode, `steps[${index}].scrollMode`),
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
    const hasUntilDeltaGte = Object.prototype.hasOwnProperty.call(step, "untilDeltaGte");
    const untilChanged = parseOptionalBoolean(step.untilChanged, `steps[${index}].untilChanged`);
    const hasUntilChanged = untilChanged === true;
    const conditionCount = Number(hasUntilEquals) + Number(hasUntilGte) + Number(hasUntilDeltaGte) + Number(hasUntilChanged);
    if (conditionCount !== 1) {
      throw new CliError(
        "E_QUERY_INVALID",
        `steps[${index}] repeat-until requires exactly one condition: untilEquals, untilGte, untilDeltaGte, or untilChanged=true`,
      );
    }

    const untilGte = hasUntilGte ? parseOptionalInteger(step.untilGte, `steps[${index}].untilGte`) : undefined;
    if (hasUntilGte && typeof untilGte !== "number") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].untilGte must be an integer`);
    }
    const untilDeltaGte = hasUntilDeltaGte ? parseOptionalInteger(step.untilDeltaGte, `steps[${index}].untilDeltaGte`) : undefined;
    if (hasUntilDeltaGte && typeof untilDeltaGte !== "number") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].untilDeltaGte must be an integer`);
    }
    if (typeof untilDeltaGte === "number" && untilDeltaGte < 0) {
      throw new CliError("E_QUERY_INVALID", `steps[${index}].untilDeltaGte must be >= 0`);
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
      const currentDelta =
        typeof currentValue === "number" && typeof previousValue === "number" ? currentValue - previousValue : null;
      let matched = false;
      if (hasUntilEquals) {
        matched = isDeepStrictEqual(currentValue, step.untilEquals);
      } else if (hasUntilGte) {
        matched = typeof currentValue === "number" && typeof untilGte === "number" && currentValue >= untilGte;
      } else if (hasUntilDeltaGte) {
        matched =
          attempt > 1 &&
          typeof currentDelta === "number" &&
          typeof untilDeltaGte === "number" &&
          currentDelta >= untilDeltaGte;
      } else if (hasUntilChanged) {
        matched = attempt > 1 && !isDeepStrictEqual(currentValue, previousValue);
      }

      attempts.push({
        attempt,
        matched,
        value: typeof currentValue === "undefined" ? null : currentValue,
        ...(typeof currentDelta === "number" ? { delta: currentDelta } : {}),
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
          : hasUntilDeltaGte
            ? { kind: "delta-gte", path: untilPath, threshold: untilDeltaGte ?? null }
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
