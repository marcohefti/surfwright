import fs from "node:fs";
import { CliError } from "./errors.js";

export type PipelineStepInput = {
  id: string;
  targetId?: string;
  url?: string;
  reuseUrl?: boolean;
  timeoutMs?: number;
  text?: string;
  selector?: string;
  contains?: string;
  visibleOnly?: boolean;
  first?: boolean;
  limit?: number;
  chunkSize?: number;
  chunk?: number;
  forText?: string;
  forSelector?: string;
  networkIdle?: boolean;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  snapshot?: boolean;
  noPersist?: boolean;
};

export type PipelineOps = {
  open: (opts: { url: string; timeoutMs: number; sessionId?: string; reuseUrl: boolean }) => Promise<Record<string, unknown>>;
  list: (opts: { timeoutMs: number; sessionId?: string; persistState: boolean }) => Promise<Record<string, unknown>>;
  snapshot: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    selectorQuery?: string;
    visibleOnly: boolean;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  find: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    first: boolean;
    limit?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  click: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    textQuery?: string;
    selectorQuery?: string;
    containsQuery?: string;
    visibleOnly: boolean;
    waitForText?: string;
    waitForSelector?: string;
    waitNetworkIdle: boolean;
    snapshot: boolean;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  read: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    selectorQuery?: string;
    visibleOnly: boolean;
    chunkSize?: number;
    chunkIndex?: number;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
  wait: (opts: {
    targetId: string;
    timeoutMs: number;
    sessionId?: string;
    forText?: string;
    forSelector?: string;
    networkIdle: boolean;
    persistState: boolean;
  }) => Promise<Record<string, unknown>>;
};

export async function executePipelinePlan(opts: {
  planPath: string;
  timeoutMs: number;
  sessionId?: string;
  ops: PipelineOps;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const raw = fs.readFileSync(opts.planPath, "utf8");
  const parsed = JSON.parse(raw) as { steps?: unknown };
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new CliError("E_QUERY_INVALID", "plan.steps must be a non-empty array");
  }

  const steps = parsed.steps as PipelineStepInput[];
  const results: Array<Record<string, unknown>> = [];
  const ctx: {
    sessionId?: string;
    targetId?: string;
  } = {
    sessionId: opts.sessionId,
    targetId: undefined,
  };

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || typeof step !== "object" || typeof step.id !== "string") {
      throw new CliError("E_QUERY_INVALID", `steps[${index}] must include id`);
    }

    const stepTimeoutMs = typeof step.timeoutMs === "number" ? step.timeoutMs : opts.timeoutMs;
    const stepStartedAt = Date.now();
    const stepTargetId = typeof step.targetId === "string" && step.targetId.length > 0 ? step.targetId : ctx.targetId;

    let report: Record<string, unknown>;

    switch (step.id) {
      case "open": {
        if (typeof step.url !== "string" || step.url.length === 0) {
          throw new CliError("E_QUERY_INVALID", `steps[${index}].url is required for open`);
        }
        report = await opts.ops.open({
          url: step.url,
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
          selectorQuery: step.selector,
          visibleOnly: Boolean(step.visibleOnly),
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
          textQuery: step.text,
          selectorQuery: step.selector,
          containsQuery: step.contains,
          visibleOnly: Boolean(step.visibleOnly),
          first: Boolean(step.first),
          limit: typeof step.limit === "number" ? step.limit : undefined,
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
          textQuery: step.text,
          selectorQuery: step.selector,
          containsQuery: step.contains,
          visibleOnly: Boolean(step.visibleOnly),
          waitForText: step.waitForText,
          waitForSelector: step.waitForSelector,
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
          selectorQuery: step.selector,
          visibleOnly: Boolean(step.visibleOnly),
          chunkSize: typeof step.chunkSize === "number" ? step.chunkSize : undefined,
          chunkIndex: typeof step.chunk === "number" ? step.chunk : undefined,
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
          forText: step.forText,
          forSelector: step.forSelector,
          networkIdle: Boolean(step.networkIdle),
          persistState: !Boolean(step.noPersist),
        });
        break;
      }
      default:
        throw new CliError("E_QUERY_INVALID", `Unsupported step id: ${step.id}`);
    }

    if (typeof report.sessionId === "string") {
      ctx.sessionId = report.sessionId;
    }
    if (typeof report.targetId === "string") {
      ctx.targetId = report.targetId;
    }

    results.push({
      index,
      id: step.id,
      elapsedMs: Date.now() - stepStartedAt,
      report,
    });
  }

  return {
    ok: true,
    sessionId: ctx.sessionId ?? null,
    targetId: ctx.targetId ?? null,
    steps: results,
    totalMs: Date.now() - startedAt,
  };
}
