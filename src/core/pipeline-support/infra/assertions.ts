import type { PipelineAssertionInput, PipelineStepInput } from "./plan-types.js";
import { readPathValue } from "./plan.js";

export type PipelineAssertionCheck = {
  kind: string;
  path: string;
  ok: boolean;
  message: string;
};

export function evaluateAssertionSpec(assert: PipelineAssertionInput | undefined, report: Record<string, unknown>) {
  const checks: PipelineAssertionCheck[] = [];
  if (!assert || typeof assert !== "object") {
    return { total: 0, failed: 0, checks };
  }
  const equals = typeof assert.equals === "object" && assert.equals !== null ? assert.equals : {};
  for (const [pathExpr, expected] of Object.entries(equals)) {
    const actual = readPathValue(report, pathExpr);
    const ok = Object.is(actual, expected);
    checks.push({
      kind: "equals",
      path: pathExpr,
      ok,
      message: ok ? "ok" : `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
    });
  }
  const contains = typeof assert.contains === "object" && assert.contains !== null ? assert.contains : {};
  for (const [pathExpr, needle] of Object.entries(contains)) {
    const actual = readPathValue(report, pathExpr);
    const text = typeof actual === "string" ? actual : "";
    const expectedText = typeof needle === "string" ? needle : JSON.stringify(needle);
    const ok = text.includes(expectedText);
    checks.push({
      kind: "contains",
      path: pathExpr,
      ok,
      message: ok ? "ok" : `expected string to include ${JSON.stringify(expectedText)}`,
    });
  }
  const gte = typeof assert.gte === "object" && assert.gte !== null ? assert.gte : {};
  for (const [pathExpr, thresholdRaw] of Object.entries(gte)) {
    const actual = readPathValue(report, pathExpr);
    const threshold = typeof thresholdRaw === "number" ? thresholdRaw : Number.NaN;
    const ok = Number.isFinite(threshold) && typeof actual === "number" && actual >= threshold;
    checks.push({
      kind: "gte",
      path: pathExpr,
      ok,
      message: ok
        ? "ok"
        : `expected number >= ${JSON.stringify(thresholdRaw)} but got ${JSON.stringify(actual)}`,
    });
  }
  const truthy = Array.isArray(assert.truthy) ? assert.truthy : [];
  for (const pathExpr of truthy) {
    if (typeof pathExpr !== "string") {
      continue;
    }
    const ok = Boolean(readPathValue(report, pathExpr));
    checks.push({ kind: "truthy", path: pathExpr, ok, message: ok ? "ok" : "expected truthy value" });
  }
  const exists = Array.isArray(assert.exists) ? assert.exists : [];
  for (const pathExpr of exists) {
    if (typeof pathExpr !== "string") {
      continue;
    }
    const ok = typeof readPathValue(report, pathExpr) !== "undefined";
    checks.push({ kind: "exists", path: pathExpr, ok, message: ok ? "ok" : "expected path to exist" });
  }
  return { total: checks.length, failed: checks.filter((entry) => !entry.ok).length, checks };
}

export function evaluateAssertions(step: PipelineStepInput, report: Record<string, unknown>) {
  return evaluateAssertionSpec(step.assert, report);
}
