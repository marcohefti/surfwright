import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { parseTargetQueryInput } from "../infra/target-query.js";
import { parseFrameScope } from "../infra/target-find.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../infra/targets.js";
import { createCdpEvaluator, ensureValidSelectorSyntaxCdp, frameIdsForScope, getCdpFrameTree, openCdpSession } from "../infra/cdp/index.js";
import { cdpQueryOp } from "./cdp-query-op.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs } from "./click-utils.js";
import { waitAfterClickWithBudget } from "./click-wait.js";
import { readSelectorCountAfter } from "./click-proof.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../shared/index.js";
import { connectSessionBrowser } from "../../session/infra/runtime-access.js";

type TargetFillReport = {
  ok: true;
  sessionId: string;
  sessionSource?: string;
  targetId: string;
  actionId: string;
  mode?: "text" | "selector";
  selector?: string | null;
  contains?: string | null;
  visibleOnly?: boolean;
  matchCount?: number;
  pickedIndex?: number;
  query: string;
  valueLength: number;
  eventMode?: "minimal" | "realistic" | "none" | "custom";
  eventsDispatched?: string[];
  url: string;
  title: string;
  wait?: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  } | null;
  assertions?: import("../../types.js").ActionAssertionReport | null;
  proof?: {
    action: "fill";
    urlChanged: boolean;
    waitSatisfied: boolean;
    finalUrl: string;
    finalTitle: string;
    queryMode: "text" | "selector";
    query: string;
    selector: string | null;
    eventMode?: "minimal" | "realistic" | "none" | "custom";
    eventsDispatched?: string[];
    countAfter: number | null;
  };
  proofEnvelope?: import("../../types.js").ActionProofEnvelope;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseFillValue(input: string | undefined): string {
  if (typeof input !== "string") throw new CliError("E_QUERY_INVALID", "value is required");
  return input;
}

const FILL_EVENT_PRESETS: Record<"minimal" | "realistic" | "none", string[]> = {
  minimal: ["input", "change"],
  realistic: ["keydown", "keypress", "input", "keyup", "change"],
  none: [],
};

const SUPPORTED_FILL_EVENTS = new Set(["input", "change", "keyup", "keydown", "keypress", "blur"]);

function parseFillEventPolicy(opts: {
  eventsInput?: string;
  eventModeInput?: string;
}): { eventMode: "minimal" | "realistic" | "none" | "custom"; events: string[]; includeInReport: boolean } {
  const rawEvents = typeof opts.eventsInput === "string" ? opts.eventsInput.trim() : "";
  const rawMode = typeof opts.eventModeInput === "string" ? opts.eventModeInput.trim().toLowerCase() : "";
  const hasEvents = rawEvents.length > 0;
  const hasMode = rawMode.length > 0;
  if (hasEvents && hasMode) {
    throw new CliError("E_QUERY_INVALID", "Use either --events or --event-mode, not both");
  }
  if (!hasEvents && !hasMode) {
    return {
      eventMode: "minimal",
      events: [...FILL_EVENT_PRESETS.minimal],
      includeInReport: false,
    };
  }
  if (hasMode) {
    if (rawMode !== "minimal" && rawMode !== "realistic" && rawMode !== "none") {
      throw new CliError("E_QUERY_INVALID", "event-mode must be one of: minimal, realistic, none");
    }
    return {
      eventMode: rawMode,
      events: [...FILL_EVENT_PRESETS[rawMode]],
      includeInReport: true,
    };
  }

  const requested = rawEvents
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (requested.length < 1) {
    throw new CliError("E_QUERY_INVALID", "events must contain at least one event name");
  }
  if (requested.length > 8) {
    throw new CliError("E_QUERY_INVALID", "events supports at most 8 names");
  }
  const deduped: string[] = [];
  for (const name of requested) {
    if (!SUPPORTED_FILL_EVENTS.has(name)) {
      throw new CliError("E_QUERY_INVALID", `unsupported fill event: ${name}`);
    }
    if (!deduped.includes(name)) {
      deduped.push(name);
    }
  }
  return {
    eventMode: "custom",
    events: deduped,
    includeInReport: true,
  };
}

export async function targetFill(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  value?: string;
  eventsInput?: string;
  eventModeInput?: string;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetFillReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const value = parseFillValue(opts.value);
  const eventPolicy = parseFillEventPolicy({
    eventsInput: opts.eventsInput,
    eventModeInput: opts.eventModeInput,
  });
  const frameScope = parseFrameScope(opts.frameScope);
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });
  const waitTimeoutMs = resolveWaitTimeoutMs(opts.waitTimeoutMs, opts.timeoutMs);
  const includeProof = Boolean(opts.proof);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });

    if (parsed.mode === "selector" && typeof parsed.selector === "string") {
      await ensureValidSelectorSyntaxCdp({
        cdp,
        frameCdpId: frameTree.frame.id,
        worldCache,
        selectorQuery: parsed.selector,
      });
    }

    const perFrameCounts: Array<{ frameCdpId: string; rawCount: number; firstVisibleIndex: number | null }> = [];
    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
      const summary = (await evaluator.evaluate(cdpQueryOp, {
        op: "summary",
        mode: parsed.mode,
        query: parsed.query,
        selector: parsed.selector,
        contains: parsed.contains,
      })) as { rawCount: number; firstVisibleIndex: number | null };
      perFrameCounts.push({ frameCdpId, rawCount: summary.rawCount, firstVisibleIndex: summary.firstVisibleIndex });
    }

    const matchCount = perFrameCounts.reduce((sum, entry) => sum + entry.rawCount, 0);
    if (matchCount < 1) {
      throw new CliError("E_QUERY_INVALID", parsed.visibleOnly ? "No visible element matched fill query" : "No element matched fill query");
    }

    let pickedIndex = 0;
    if (parsed.visibleOnly) {
      let found: number | null = null;
      let offset = 0;
      for (const entry of perFrameCounts) {
        if (typeof entry.firstVisibleIndex === "number") {
          found = offset + entry.firstVisibleIndex;
          break;
        }
        offset += entry.rawCount;
      }
      if (found === null) {
        throw new CliError("E_QUERY_INVALID", "No visible element matched fill query");
      }
      pickedIndex = found;
    }

    // Resolve pickedIndex -> frame/localIndex.
    let offset = 0;
    let frameCdpId: string | null = null;
    let localIndex = -1;
    for (const entry of perFrameCounts) {
      if (pickedIndex < offset + entry.rawCount) {
        frameCdpId = entry.frameCdpId;
        localIndex = pickedIndex - offset;
        break;
      }
      offset += entry.rawCount;
    }
    if (!frameCdpId || localIndex < 0) {
      throw new CliError("E_INTERNAL", "Unable to resolve fill target");
    }

    const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
    const urlBeforeFill = target.page.url();
    const filled = (await evaluator.evaluate(cdpQueryOp, {
      op: "fill",
      mode: parsed.mode,
      query: parsed.query,
      selector: parsed.selector,
      contains: parsed.contains,
      index: localIndex,
      fillValue: value,
      fillEvents: eventPolicy.events,
    })) as { filled: boolean; valueLength: number; eventsDispatched: string[] };

    if (!filled.filled) {
      throw new CliError("E_QUERY_INVALID", "matched element is not fillable");
    }

    const waited = await waitAfterClickWithBudget({
      waitAfter,
      waitTimeoutMs,
      page: target.page,
      cdp,
      frameTree,
      worldCache,
      queryMode: parsed.mode,
      query: parsed.query,
      visibleOnly: parsed.visibleOnly,
      frameScope,
    });

    const countAfter = await readSelectorCountAfter({
      enabled: includeProof,
      cdp,
      worldCache,
      queryMode: parsed.mode,
      frameScope,
      query: parsed.query,
      selector: parsed.selector,
      contains: parsed.contains,
    });

    const finalUrl = target.page.url();
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const title = await target.page.title();
    const actionCompletedAt = Date.now();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "fill",
          urlBefore: urlBeforeFill,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount,
          pickedIndex,
          wait: toActionWaitEvidence({
            requested: waitAfter ? { ...waitAfter, timeoutMs: waitTimeoutMs } : null,
            observed: waited,
          }),
          assertions,
          countAfter,
          details: {
            queryMode: parsed.mode,
            query: parsed.query,
            selector: parsed.selector,
            finalTitle: title,
          },
        })
      : null;

    const report: TargetFillReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      mode: parsed.mode,
      selector: parsed.selector,
      contains: parsed.contains,
      visibleOnly: parsed.visibleOnly,
      matchCount,
      pickedIndex,
      query: parsed.query,
      valueLength: value.length,
      ...(eventPolicy.includeInReport
        ? {
            eventMode: eventPolicy.eventMode,
            eventsDispatched: filled.eventsDispatched,
          }
        : {}),
      url: finalUrl,
      title,
      wait: waited,
      ...(assertions ? { assertions } : {}),
      ...(includeProof
        ? {
            proof: {
              action: "fill",
              urlChanged: urlBeforeFill !== finalUrl,
              waitSatisfied: waited ? waited.satisfied : true,
              finalUrl,
              finalTitle: title,
              queryMode: parsed.mode,
              query: parsed.query,
              selector: parsed.selector,
              eventMode: eventPolicy.eventMode,
              eventsDispatched: filled.eventsDispatched,
              countAfter,
            },
            ...(proofEnvelope ? { proofEnvelope } : {}),
          }
        : {}),
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "fill",
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
