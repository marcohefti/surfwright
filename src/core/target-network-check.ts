import fs from "node:fs";
import { CliError } from "./errors.js";
import { resolveNetworkReportSource } from "./target-network-source.js";
import { targetNetwork } from "./target-network.js";
import type { TargetNetworkCheckBudget, TargetNetworkCheckReport } from "./types.js";

function parseBudget(path: string): TargetNetworkCheckBudget {
  const value = path.trim();
  if (!value) {
    throw new CliError("E_QUERY_INVALID", "budget path must not be empty");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(value, "utf8")) as unknown;
  } catch {
    throw new CliError("E_QUERY_INVALID", `Failed to read budget file: ${value}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new CliError("E_QUERY_INVALID", "budget file must contain a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const budget: TargetNetworkCheckBudget = {};
  const assignNumber = (key: keyof TargetNetworkCheckBudget, opts: { min: number; max: number }) => {
    const candidate = input[key as string];
    if (typeof candidate === "undefined") {
      return;
    }
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < opts.min || candidate > opts.max) {
      throw new CliError("E_QUERY_INVALID", `${key} must be a number between ${opts.min} and ${opts.max}`);
    }
    budget[key] = candidate;
  };
  assignNumber("maxP95LatencyMs", { min: 1, max: 120000 });
  assignNumber("maxErrorRate", { min: 0, max: 1 });
  assignNumber("maxBytesApproxTotal", { min: 1, max: 10_000_000_000 });
  assignNumber("maxWsMessages", { min: 0, max: 10_000_000 });
  assignNumber("maxRequests", { min: 1, max: 10_000_000 });
  if (Object.keys(budget).length === 0) {
    throw new CliError("E_QUERY_INVALID", "budget file does not define any supported checks");
  }
  return budget;
}

function buildChecks(opts: {
  budget: TargetNetworkCheckBudget;
  metrics: TargetNetworkCheckReport["metrics"];
}): TargetNetworkCheckReport["checks"] {
  const checks: TargetNetworkCheckReport["checks"] = [];
  if (typeof opts.budget.maxP95LatencyMs === "number") {
    checks.push({
      name: "maxP95LatencyMs",
      limit: opts.budget.maxP95LatencyMs,
      actual: opts.metrics.p95LatencyMs ?? Number.POSITIVE_INFINITY,
      passed: typeof opts.metrics.p95LatencyMs === "number" && opts.metrics.p95LatencyMs <= opts.budget.maxP95LatencyMs,
    });
  }
  if (typeof opts.budget.maxErrorRate === "number") {
    checks.push({
      name: "maxErrorRate",
      limit: opts.budget.maxErrorRate,
      actual: opts.metrics.errorRate,
      passed: opts.metrics.errorRate <= opts.budget.maxErrorRate,
    });
  }
  if (typeof opts.budget.maxBytesApproxTotal === "number") {
    checks.push({
      name: "maxBytesApproxTotal",
      limit: opts.budget.maxBytesApproxTotal,
      actual: opts.metrics.bytesApproxTotal,
      passed: opts.metrics.bytesApproxTotal <= opts.budget.maxBytesApproxTotal,
    });
  }
  if (typeof opts.budget.maxWsMessages === "number") {
    checks.push({
      name: "maxWsMessages",
      limit: opts.budget.maxWsMessages,
      actual: opts.metrics.wsMessages,
      passed: opts.metrics.wsMessages <= opts.budget.maxWsMessages,
    });
  }
  if (typeof opts.budget.maxRequests === "number") {
    checks.push({
      name: "maxRequests",
      limit: opts.budget.maxRequests,
      actual: opts.metrics.requests,
      passed: opts.metrics.requests <= opts.budget.maxRequests,
    });
  }
  return checks;
}

export async function targetNetworkCheck(opts: {
  budgetPath: string;
  targetId?: string;
  timeoutMs: number;
  sessionId?: string;
  captureId?: string;
  artifactId?: string;
  profile?: string;
  captureMs?: number;
  maxRequests?: number;
  maxWebSockets?: number;
  maxWsMessages?: number;
}): Promise<TargetNetworkCheckReport> {
  const budget = parseBudget(opts.budgetPath);
  const reportSource =
    typeof opts.targetId === "string" && opts.targetId.trim().length > 0
      ? {
          source: { kind: "capture-live" as const, id: opts.targetId },
          report: await targetNetwork({
            targetId: opts.targetId,
            timeoutMs: opts.timeoutMs,
            sessionId: opts.sessionId,
            profile: opts.profile ?? "perf",
            view: "summary",
            captureMs: opts.captureMs,
            maxRequests: opts.maxRequests,
            maxWebSockets: opts.maxWebSockets,
            maxWsMessages: opts.maxWsMessages,
          }),
        }
      : (() => {
          const loaded = resolveNetworkReportSource({
            captureId: opts.captureId,
            artifactId: opts.artifactId,
          });
          return {
            source: {
              kind: loaded.source.kind === "capture" ? ("capture-saved" as const) : ("artifact" as const),
              id: loaded.source.id,
            },
            report: loaded.report,
          };
        })();

  const requestCount = reportSource.report.counts.requestsReturned;
  const failureCount =
    reportSource.report.requests.length > 0
      ? reportSource.report.requests.filter((request) => request.failure !== null).length
      : reportSource.report.counts.failedSeen;
  const metrics: TargetNetworkCheckReport["metrics"] = {
    requests: requestCount,
    failures: failureCount,
    errorRate: requestCount === 0 ? 0 : Math.round((failureCount / requestCount) * 10000) / 10000,
    p95LatencyMs: reportSource.report.performance.latencyMs.p95,
    bytesApproxTotal: reportSource.report.performance.bytesApproxTotal,
    wsMessages: reportSource.report.counts.wsMessagesReturned,
  };
  const checks = buildChecks({
    budget,
    metrics,
  });
  return {
    ok: true,
    passed: checks.every((check) => check.passed),
    source: reportSource.source,
    metrics,
    checks,
    budget,
  };
}
