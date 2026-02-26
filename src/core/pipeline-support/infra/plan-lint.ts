import { SUPPORTED_STEP_IDS, type PipelineLintIssue, type PipelineStepInput } from "./plan-types.js";

const STEP_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function lintAssertionSpec(opts: {
  input: unknown;
  path: string;
  issues: PipelineLintIssue[];
  isTemplateString: (value: unknown) => boolean;
}): void {
  const { input, path, issues, isTemplateString } = opts;
  if (typeof input === "undefined") {
    return;
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push({ level: "error", path, message: `${path} must be an object` });
    return;
  }
  const assertion = input as {
    equals?: unknown;
    contains?: unknown;
    truthy?: unknown;
    exists?: unknown;
    gte?: unknown;
  };
  if (
    typeof assertion.equals !== "undefined" &&
    (typeof assertion.equals !== "object" || assertion.equals === null || Array.isArray(assertion.equals))
  ) {
    issues.push({ level: "error", path: `${path}.equals`, message: `${path}.equals must be an object map` });
  }
  if (
    typeof assertion.contains !== "undefined" &&
    (typeof assertion.contains !== "object" || assertion.contains === null || Array.isArray(assertion.contains))
  ) {
    issues.push({ level: "error", path: `${path}.contains`, message: `${path}.contains must be an object map` });
  }
  if (
    typeof assertion.gte !== "undefined" &&
    (typeof assertion.gte !== "object" || assertion.gte === null || Array.isArray(assertion.gte))
  ) {
    issues.push({ level: "error", path: `${path}.gte`, message: `${path}.gte must be an object map` });
  } else if (typeof assertion.gte === "object" && assertion.gte !== null) {
    for (const [expr, threshold] of Object.entries(assertion.gte)) {
      if (typeof threshold !== "number" && !isTemplateString(threshold)) {
        issues.push({
          level: "error",
          path: `${path}.gte.${expr}`,
          message: `${path}.gte values must be numbers`,
        });
      }
      if (typeof threshold === "number" && !Number.isFinite(threshold)) {
        issues.push({
          level: "error",
          path: `${path}.gte.${expr}`,
          message: `${path}.gte values must be finite numbers`,
        });
      }
    }
  }
  if (typeof assertion.truthy !== "undefined") {
    if (!Array.isArray(assertion.truthy)) {
      issues.push({ level: "error", path: `${path}.truthy`, message: `${path}.truthy must be a string[]` });
    } else {
      for (let idx = 0; idx < assertion.truthy.length; idx += 1) {
        const item = assertion.truthy[idx];
        if (typeof item !== "string" || item.trim().length === 0) {
          issues.push({
            level: "error",
            path: `${path}.truthy[${idx}]`,
            message: `${path}.truthy entries must be non-empty strings`,
          });
        }
      }
    }
  }
  if (typeof assertion.exists !== "undefined") {
    if (!Array.isArray(assertion.exists)) {
      issues.push({ level: "error", path: `${path}.exists`, message: `${path}.exists must be a string[]` });
    } else {
      for (let idx = 0; idx < assertion.exists.length; idx += 1) {
        const item = assertion.exists[idx];
        if (typeof item !== "string" || item.trim().length === 0) {
          issues.push({
            level: "error",
            path: `${path}.exists[${idx}]`,
            message: `${path}.exists entries must be non-empty strings`,
          });
        }
      }
    }
  }
}

export function lintPlan(input: { steps: PipelineStepInput[]; result?: Record<string, unknown>; require?: unknown }): PipelineLintIssue[] {
  const issues: PipelineLintIssue[] = [];
  const aliases = new Set<string>();

  // Pipeline steps can contain {{ templates }} that resolve at runtime to non-string values.
  // Lint should reject obviously invalid shapes, but avoid flagging template strings that may
  // legitimately resolve to the correct type during execution.
  const isTemplateString = (value: unknown): boolean =>
    typeof value === "string" && value.includes("{{") && value.includes("}}");

  for (let index = 0; index < input.steps.length; index += 1) {
    const step = input.steps[index];
    if (!step || typeof step !== "object") {
      issues.push({ level: "error", path: `steps[${index}]`, message: "step must be an object" });
      continue;
    }
    if (typeof step.id !== "string" || step.id.trim().length === 0) {
      issues.push({ level: "error", path: `steps[${index}].id`, message: "step id is required" });
      continue;
    }
    if (!SUPPORTED_STEP_IDS.has(step.id)) {
      issues.push({ level: "error", path: `steps[${index}].id`, message: `unsupported step id: ${step.id}` });
      continue;
    }
    if (typeof step.targetId !== "undefined" && typeof step.targetId !== "string" && !isTemplateString(step.targetId)) {
      issues.push({ level: "error", path: `steps[${index}].targetId`, message: "targetId must be a string" });
    }
    if (step.id === "open" && (typeof step.url !== "string" || step.url.trim().length === 0)) {
      issues.push({ level: "error", path: `steps[${index}].url`, message: "url is required for open" });
    }
    if (
      (step.id === "click" || step.id === "click-read" || step.id === "clickRead" || step.id === "find" || step.id === "count" || step.id === "fill") &&
      (!step.text || (typeof step.text !== "string" && !isTemplateString(step.text))) &&
      (!step.selector || (typeof step.selector !== "string" && !isTemplateString(step.selector)))
    ) {
      issues.push({ level: "error", path: `steps[${index}]`, message: `${step.id} requires text or selector` });
    }
    if (step.id === "fill" && typeof step.value !== "string" && !isTemplateString(step.value)) {
      issues.push({ level: "error", path: `steps[${index}].value`, message: "value is required for fill" });
    }
    if (step.id === "scroll-plan" || step.id === "scrollPlan") {
      if (typeof step.scrollMode !== "undefined" && typeof step.scrollMode !== "string" && !isTemplateString(step.scrollMode)) {
        issues.push({ level: "error", path: `steps[${index}].scrollMode`, message: "scrollMode must be a string" });
      }
      if (
        typeof step.scrollMode === "string" &&
        !isTemplateString(step.scrollMode) &&
        step.scrollMode !== "absolute" &&
        step.scrollMode !== "relative"
      ) {
        issues.push({
          level: "error",
          path: `steps[${index}].scrollMode`,
          message: "scrollMode must be one of: absolute, relative",
        });
      }
      if (typeof step.steps !== "undefined" && typeof step.steps !== "string" && !isTemplateString(step.steps)) {
        issues.push({ level: "error", path: `steps[${index}].steps`, message: "steps must be a csv string" });
      }
      if (typeof step.settleMs !== "undefined" && typeof step.settleMs !== "number" && !isTemplateString(step.settleMs)) {
        issues.push({ level: "error", path: `steps[${index}].settleMs`, message: "settleMs must be an integer" });
      }
      if (
        typeof step.countSelector !== "undefined" &&
        typeof step.countSelector !== "string" &&
        !isTemplateString(step.countSelector)
      ) {
        issues.push({ level: "error", path: `steps[${index}].countSelector`, message: "countSelector must be a string" });
      }
      if (
        typeof step.countContains !== "undefined" &&
        typeof step.countContains !== "string" &&
        !isTemplateString(step.countContains)
      ) {
        issues.push({ level: "error", path: `steps[${index}].countContains`, message: "countContains must be a string" });
      }
      if (
        typeof step.countContains !== "undefined" &&
        typeof step.countSelector === "undefined" &&
        !isTemplateString(step.countContains)
      ) {
        issues.push({ level: "error", path: `steps[${index}].countContains`, message: "countContains requires countSelector" });
      }
      if (typeof step.countVisibleOnly !== "undefined" && typeof step.countVisibleOnly !== "boolean" && !isTemplateString(step.countVisibleOnly)) {
        issues.push({ level: "error", path: `steps[${index}].countVisibleOnly`, message: "countVisibleOnly must be a boolean" });
      }
      if (
        step.countVisibleOnly === true &&
        typeof step.countSelector === "undefined" &&
        !isTemplateString(step.countVisibleOnly)
      ) {
        issues.push({
          level: "error",
          path: `steps[${index}].countVisibleOnly`,
          message: "countVisibleOnly requires countSelector",
        });
      }
    }
    if (step.id === "repeat-until" || step.id === "repeatUntil") {
      if (typeof step.step !== "object" || step.step === null || Array.isArray(step.step)) {
        issues.push({ level: "error", path: `steps[${index}].step`, message: "step must be an object" });
      } else {
        const nested = step.step as PipelineStepInput;
        if (typeof nested.id !== "string" || nested.id.trim().length === 0) {
          issues.push({ level: "error", path: `steps[${index}].step.id`, message: "nested step id is required" });
        } else if (!SUPPORTED_STEP_IDS.has(nested.id)) {
          issues.push({
            level: "error",
            path: `steps[${index}].step.id`,
            message: `unsupported nested step id: ${nested.id}`,
          });
        } else if (nested.id === "repeat-until" || nested.id === "repeatUntil") {
          issues.push({
            level: "error",
            path: `steps[${index}].step.id`,
            message: "nested repeat-until is not supported",
          });
        }
        if (typeof nested.as !== "undefined") {
          issues.push({
            level: "error",
            path: `steps[${index}].step.as`,
            message: "nested step must not define as; use top-level step.as",
          });
        }
      }
      if (
        typeof step.maxAttempts !== "undefined" &&
        typeof step.maxAttempts !== "number" &&
        !isTemplateString(step.maxAttempts)
      ) {
        issues.push({ level: "error", path: `steps[${index}].maxAttempts`, message: "maxAttempts must be an integer" });
      }
      if (
        typeof step.maxAttempts === "number" &&
        (step.maxAttempts < 1 || step.maxAttempts > 25 || !Number.isInteger(step.maxAttempts))
      ) {
        issues.push({
          level: "error",
          path: `steps[${index}].maxAttempts`,
          message: "maxAttempts must be an integer between 1 and 25",
        });
      }
      const untilPathProvided = typeof step.untilPath !== "undefined";
      if (
        !untilPathProvided ||
        (typeof step.untilPath !== "string" && !isTemplateString(step.untilPath)) ||
        (typeof step.untilPath === "string" && step.untilPath.trim().length === 0)
      ) {
        issues.push({
          level: "error",
          path: `steps[${index}].untilPath`,
          message: "untilPath is required and must be a non-empty string",
        });
      }
      const hasUntilEquals = Object.prototype.hasOwnProperty.call(step, "untilEquals");
      const hasUntilGte = Object.prototype.hasOwnProperty.call(step, "untilGte");
      const hasUntilDeltaGte = Object.prototype.hasOwnProperty.call(step, "untilDeltaGte");
      const hasUntilChanged = Object.prototype.hasOwnProperty.call(step, "untilChanged");
      const enabledUntilChanged = step.untilChanged === true || isTemplateString(step.untilChanged);
      if (hasUntilGte && typeof step.untilGte !== "number" && !isTemplateString(step.untilGte)) {
        issues.push({ level: "error", path: `steps[${index}].untilGte`, message: "untilGte must be an integer" });
      }
      if (typeof step.untilGte === "number" && !Number.isInteger(step.untilGte)) {
        issues.push({ level: "error", path: `steps[${index}].untilGte`, message: "untilGte must be an integer" });
      }
      if (hasUntilDeltaGte && typeof step.untilDeltaGte !== "number" && !isTemplateString(step.untilDeltaGte)) {
        issues.push({
          level: "error",
          path: `steps[${index}].untilDeltaGte`,
          message: "untilDeltaGte must be an integer",
        });
      }
      if (typeof step.untilDeltaGte === "number" && !Number.isInteger(step.untilDeltaGte)) {
        issues.push({
          level: "error",
          path: `steps[${index}].untilDeltaGte`,
          message: "untilDeltaGte must be an integer",
        });
      }
      if (hasUntilChanged && typeof step.untilChanged !== "boolean" && !isTemplateString(step.untilChanged)) {
        issues.push({
          level: "error",
          path: `steps[${index}].untilChanged`,
          message: "untilChanged must be a boolean",
        });
      }
      if (hasUntilChanged && step.untilChanged === false) {
        issues.push({
          level: "error",
          path: `steps[${index}].untilChanged`,
          message: "untilChanged must be true when provided",
        });
      }
      const conditionCount = Number(hasUntilEquals) + Number(hasUntilGte) + Number(hasUntilDeltaGte) + Number(enabledUntilChanged);
      if (conditionCount !== 1) {
        issues.push({
          level: "error",
          path: `steps[${index}]`,
          message: "repeat-until requires exactly one condition: untilEquals, untilGte, untilDeltaGte, or untilChanged=true",
        });
      }
    }
    if (step.id === "upload") {
      const selectorValid = typeof step.selector === "string" || isTemplateString(step.selector);
      if (!selectorValid) {
        issues.push({ level: "error", path: `steps[${index}].selector`, message: "selector is required for upload" });
      }
      const filesInput = typeof step.files !== "undefined" ? step.files : step.file;
      if (typeof filesInput === "undefined") {
        issues.push({ level: "error", path: `steps[${index}].files`, message: "files (or file) is required for upload" });
      } else if (typeof filesInput !== "string" && !Array.isArray(filesInput) && !isTemplateString(filesInput)) {
        issues.push({
          level: "error",
          path: `steps[${index}].files`,
          message: "files (or file) must be a string or string[]",
        });
      } else if (Array.isArray(filesInput) && filesInput.length < 1) {
        issues.push({ level: "error", path: `steps[${index}].files`, message: "files must include at least one path" });
      }
    }
    if (step.id === "extract" && typeof step.kind !== "undefined" && typeof step.kind !== "string") {
      issues.push({ level: "error", path: `steps[${index}].kind`, message: "kind must be a string" });
    }
    if (typeof step.as !== "undefined") {
      if (typeof step.as !== "string" || !STEP_ALIAS_RE.test(step.as)) {
        issues.push({ level: "error", path: `steps[${index}].as`, message: "alias must match /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/" });
      } else if (aliases.has(step.as)) {
        issues.push({ level: "error", path: `steps[${index}].as`, message: `duplicate alias: ${step.as}` });
      } else {
        aliases.add(step.as);
      }
    }
    lintAssertionSpec({
      input: step.assert,
      path: `steps[${index}].assert`,
      issues,
      isTemplateString,
    });
  }
  if (typeof input.result !== "undefined") {
    if (typeof input.result !== "object" || input.result === null || Array.isArray(input.result)) {
      issues.push({ level: "error", path: "result", message: "result must be an object map of outputField -> sourcePath" });
    } else {
      const entries = Object.entries(input.result);
      if (entries.length < 1) {
        issues.push({ level: "error", path: "result", message: "result map must include at least one key" });
      }
      for (const [key, value] of entries) {
        if (!STEP_ALIAS_RE.test(key)) {
          issues.push({
            level: "error",
            path: `result.${key}`,
            message: "result output field must match /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/",
          });
        }
        if (typeof value !== "string" || value.trim().length === 0) {
          issues.push({
            level: "error",
            path: `result.${key}`,
            message: "result source path must be a non-empty string",
          });
        }
      }
    }
  }
  lintAssertionSpec({
    input: input.require,
    path: "require",
    issues,
    isTemplateString,
  });
  return issues;
}
