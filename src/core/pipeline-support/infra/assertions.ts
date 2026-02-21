import type { PipelineStepInput } from "./plan.js";
import { readPathValue } from "./plan.js";

export function evaluateAssertions(step: PipelineStepInput, report: Record<string, unknown>) {
  const assert = step.assert;
  const checks: Array<{ kind: string; path: string; ok: boolean; message: string }> = [];
  if (!assert || typeof assert !== "object") {
    return { total: 0, failed: 0, checks };
  }
  const equals = typeof assert.equals === "object" && assert.equals !== null ? assert.equals : {};
  for (const [pathExpr, expected] of Object.entries(equals)) {
    const actual = readPathValue(report, pathExpr);
    const ok = Object.is(actual, expected);
    checks.push({ kind: "equals", path: pathExpr, ok, message: ok ? "ok" : `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}` });
  }
  const contains = typeof assert.contains === "object" && assert.contains !== null ? assert.contains : {};
  for (const [pathExpr, needle] of Object.entries(contains)) {
    const actual = readPathValue(report, pathExpr);
    const text = typeof actual === "string" ? actual : "";
    const expectedText = typeof needle === "string" ? needle : JSON.stringify(needle);
    checks.push({ kind: "contains", path: pathExpr, ok: text.includes(expectedText), message: text.includes(expectedText) ? "ok" : `expected string to include ${JSON.stringify(expectedText)}` });
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
