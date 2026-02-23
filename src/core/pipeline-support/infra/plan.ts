import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";
import {
  SUPPORTED_STEP_IDS,
  type LoadedPlan,
  type PipelineLintIssue,
  type PipelineResultMap,
  type PipelineStepInput,
} from "./plan-types.js";

export { SUPPORTED_STEP_IDS };
export type { LoadedPlan, PipelineLintIssue, PipelineOps, PipelineResultMap, PipelineStepInput } from "./plan-types.js";

const TEMPLATE_EXACT_RE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const TEMPLATE_EMBEDDED_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const STEP_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function readPathValue(input: unknown, pathExpr: string): unknown {
  const normalized = pathExpr.trim().replace(/\[(\d+)\]/g, ".$1");
  if (!normalized) {
    return input;
  }
  const parts = normalized.split(".").map((part) => part.trim()).filter((part) => part.length > 0);
  let cursor: unknown = input;
  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asInterpolationString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function resolveTemplateInValue(value: unknown, scope: Record<string, unknown>, pathLabel: string): unknown {
  if (typeof value === "string") {
    const exact = value.match(TEMPLATE_EXACT_RE);
    if (exact) {
      const resolved = readPathValue(scope, exact[1]);
      if (typeof resolved === "undefined") {
        throw new CliError("E_QUERY_INVALID", `Unresolved template ${value} at ${pathLabel}`);
      }
      return resolved;
    }
    let replaced = value;
    let sawTemplate = false;
    replaced = replaced.replace(TEMPLATE_EMBEDDED_RE, (_full, expr: string) => {
      const resolved = readPathValue(scope, expr);
      if (typeof resolved === "undefined") {
        throw new CliError("E_QUERY_INVALID", `Unresolved template {{${expr}}} at ${pathLabel}`);
      }
      sawTemplate = true;
      return asInterpolationString(resolved);
    });
    return sawTemplate ? replaced : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, idx) => resolveTemplateInValue(entry, scope, `${pathLabel}[${idx}]`));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = resolveTemplateInValue(nested, scope, `${pathLabel}.${key}`);
    }
    return out;
  }
  return value;
}

export function parseStepAlias(input: unknown, stepIndex: number): string | null {
  if (typeof input === "undefined") {
    return null;
  }
  if (typeof input !== "string") {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].as must be a string`);
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].as must not be empty`);
  }
  if (!STEP_ALIAS_RE.test(value)) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].as contains invalid characters`);
  }
  return value;
}

export function parseStepTimeoutMs(input: unknown, fallback: number, stepIndex: number): number {
  if (typeof input === "undefined") {
    return fallback;
  }
  if (typeof input !== "number" || !Number.isFinite(input) || !Number.isInteger(input) || input <= 0) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].timeoutMs must be a positive integer`);
  }
  return input;
}

export function parseOptionalString(input: unknown, pathLabel: string): string | undefined {
  if (typeof input === "undefined") {
    return undefined;
  }
  if (typeof input !== "string") {
    throw new CliError("E_QUERY_INVALID", `${pathLabel} must be a string`);
  }
  return input;
}

export function parseOptionalBoolean(input: unknown, pathLabel: string): boolean | undefined {
  if (typeof input === "undefined") {
    return undefined;
  }
  if (typeof input !== "boolean") {
    throw new CliError("E_QUERY_INVALID", `${pathLabel} must be a boolean`);
  }
  return input;
}

export function parseOptionalInteger(input: unknown, pathLabel: string): number | undefined {
  if (typeof input === "undefined") {
    return undefined;
  }
  if (typeof input !== "number" || !Number.isFinite(input) || !Number.isInteger(input)) {
    throw new CliError("E_QUERY_INVALID", `${pathLabel} must be an integer`);
  }
  return input;
}

export function parseOptionalStringOrStringArray(input: unknown, pathLabel: string): string[] | undefined {
  if (typeof input === "undefined") {
    return undefined;
  }
  if (typeof input === "string") {
    return [input];
  }
  if (!Array.isArray(input)) {
    throw new CliError("E_QUERY_INVALID", `${pathLabel} must be a string or string[]`);
  }
  const out: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (typeof value !== "string") {
      throw new CliError("E_QUERY_INVALID", `${pathLabel}[${index}] must be a string`);
    }
    out.push(value);
  }
  return out;
}

export function lintPlan(input: { steps: PipelineStepInput[]; result?: Record<string, unknown> }): PipelineLintIssue[] {
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
      const hasUntilChanged = Object.prototype.hasOwnProperty.call(step, "untilChanged");
      const enabledUntilChanged = step.untilChanged === true || isTemplateString(step.untilChanged);
      if (hasUntilGte && typeof step.untilGte !== "number" && !isTemplateString(step.untilGte)) {
        issues.push({ level: "error", path: `steps[${index}].untilGte`, message: "untilGte must be an integer" });
      }
      if (typeof step.untilGte === "number" && !Number.isInteger(step.untilGte)) {
        issues.push({ level: "error", path: `steps[${index}].untilGte`, message: "untilGte must be an integer" });
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
      const conditionCount = Number(hasUntilEquals) + Number(hasUntilGte) + Number(enabledUntilChanged);
      if (conditionCount !== 1) {
        issues.push({
          level: "error",
          path: `steps[${index}]`,
          message: "repeat-until requires exactly one condition: untilEquals, untilGte, or untilChanged=true",
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
    if (typeof step.assert !== "undefined") {
      if (typeof step.assert !== "object" || step.assert === null) {
        issues.push({ level: "error", path: `steps[${index}].assert`, message: "assert must be an object" });
      } else {
        if (typeof step.assert.equals !== "undefined" && (typeof step.assert.equals !== "object" || step.assert.equals === null || Array.isArray(step.assert.equals))) {
          issues.push({ level: "error", path: `steps[${index}].assert.equals`, message: "assert.equals must be an object map" });
        }
        if (typeof step.assert.contains !== "undefined" && (typeof step.assert.contains !== "object" || step.assert.contains === null || Array.isArray(step.assert.contains))) {
          issues.push({ level: "error", path: `steps[${index}].assert.contains`, message: "assert.contains must be an object map" });
        }
      }
    }
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
  return issues;
}

function parsePlanObject(raw: unknown, source: string): { steps: PipelineStepInput[]; result?: PipelineResultMap } {
  if (typeof raw !== "object" || raw === null) {
    throw new CliError("E_QUERY_INVALID", `${source} must be a JSON object`);
  }
  const record = raw as { steps?: unknown; result?: unknown };
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    throw new CliError("E_QUERY_INVALID", "plan.steps must be a non-empty array");
  }
  if (typeof record.result === "undefined") {
    return { steps: record.steps as PipelineStepInput[] };
  }
  if (typeof record.result !== "object" || record.result === null || Array.isArray(record.result)) {
    throw new CliError("E_QUERY_INVALID", "plan.result must be an object map");
  }
  return { steps: record.steps as PipelineStepInput[], result: record.result as PipelineResultMap };
}

function parseJsonWithContext(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Keep parse failures stable across Node versions; do not leak engine-specific error strings.
    throw new CliError("E_QUERY_INVALID", `${source} is not valid JSON`);
  }
}

export function resolvePlanSource(opts: {
  planPath?: string;
  planJson?: string;
  stdinPlan?: string;
  replayPath?: string;
}): LoadedPlan {
  const sourceCount = Number(Boolean(opts.planPath)) + Number(Boolean(opts.planJson)) + Number(Boolean(opts.replayPath));
  if (sourceCount === 0) {
    throw new CliError("E_QUERY_INVALID", "Provide one plan source: --plan, --plan-json, or --replay");
  }
  if (sourceCount > 1) {
    throw new CliError("E_QUERY_INVALID", "Use exactly one plan source: --plan, --plan-json, or --replay");
  }
  if (typeof opts.planJson === "string" && opts.planJson.length > 0) {
    return { source: "inline-json", replay: null, plan: parsePlanObject(parseJsonWithContext(opts.planJson, "plan-json"), "plan-json") };
  }
  if (typeof opts.planPath === "string" && opts.planPath.length > 0) {
    const raw =
      opts.planPath === "-"
        ? (typeof opts.stdinPlan === "string" ? opts.stdinPlan : "")
        : providers().fs.readFileSync(opts.planPath, "utf8");
    if (opts.planPath === "-" && raw.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", "stdin plan is empty");
    }
    const parsed = parseJsonWithContext(raw, opts.planPath === "-" ? "stdin plan" : `plan file ${opts.planPath}`);
    return { source: opts.planPath === "-" ? "stdin" : opts.planPath, replay: null, plan: parsePlanObject(parsed, "plan file") };
  }
  const replayPath = opts.replayPath as string;
  const replayParsed = parseJsonWithContext(providers().fs.readFileSync(replayPath, "utf8"), `replay artifact ${replayPath}`);
  if (typeof replayParsed !== "object" || replayParsed === null) {
    throw new CliError("E_QUERY_INVALID", "replay artifact must be an object");
  }
  const replayRecord = replayParsed as { plan?: unknown; createdAt?: unknown; label?: unknown };
  return {
    source: `replay:${replayPath}`,
    replay: {
      path: replayPath,
      recordedAt: typeof replayRecord.createdAt === "string" ? replayRecord.createdAt : null,
      label: typeof replayRecord.label === "string" ? replayRecord.label : null,
    },
    plan: parsePlanObject(replayRecord.plan, "replay artifact plan"),
  };
}
