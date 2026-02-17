import type { TargetClickExplainReport } from "../../types.js";
import { CLICK_EXPLAIN_MAX_REJECTED } from "./click-utils.js";

export async function buildClickExplainReport(opts: {
  startedAt: number;
  resolvedSessionAt: number;
  connectedAt: number;
  actionCompletedAt: number;
  sessionId: string;
  sessionSource: TargetClickExplainReport["sessionSource"];
  targetId: string;
  mode: TargetClickExplainReport["mode"];
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  matchCount: number;
  requestedIndex: number | null;
  url: string;
  title: string;
  perFrameCounts: Array<{ frameCdpId: string; rawCount: number; firstVisibleIndex: number | null }>;
  previewAt: (globalIndex: number) => Promise<{ visible: boolean; text: string; selectorHint: string | null }>;
  listRejectedInvisible: (opts: {
    frameCdpId: string;
    stopExclusive: number;
    maxRejected: number;
  }) => Promise<{ rejected: Array<{ index: number; visible: boolean; text: string; selectorHint: string | null }>; rejectedTruncated: boolean }>;
}): Promise<TargetClickExplainReport> {
  const base = {
    ok: true as const,
    sessionId: opts.sessionId,
    sessionSource: opts.sessionSource,
    targetId: opts.targetId,
    mode: opts.mode,
    selector: opts.selector,
    contains: opts.contains,
    visibleOnly: opts.visibleOnly,
    query: opts.query,
    matchCount: opts.matchCount,
    requestedIndex: opts.requestedIndex,
    url: opts.url,
    title: opts.title,
    timingMs: {
      total: opts.actionCompletedAt - opts.startedAt,
      resolveSession: opts.resolvedSessionAt - opts.startedAt,
      connectCdp: opts.connectedAt - opts.resolvedSessionAt,
      action: opts.actionCompletedAt - opts.connectedAt,
      persistState: 0,
    },
  };

  if (opts.matchCount < 1) {
    return {
      ...base,
      pickedIndex: null,
      picked: null,
      rejected: [],
      rejectedTruncated: false,
      reason: "no_match",
    };
  }

  if (opts.requestedIndex !== null) {
    if (opts.requestedIndex >= opts.matchCount) {
      return {
        ...base,
        pickedIndex: null,
        picked: null,
        rejected: [],
        rejectedTruncated: false,
        reason: "index_out_of_range",
      };
    }

    const preview = await opts.previewAt(opts.requestedIndex);
    if (opts.visibleOnly && !preview.visible) {
      return {
        ...base,
        pickedIndex: null,
        picked: null,
        rejected: [
          {
            index: opts.requestedIndex,
            reason: "not_visible",
            visible: preview.visible,
            text: preview.text,
            selectorHint: preview.selectorHint,
          },
        ],
        rejectedTruncated: false,
        reason: "no_visible_match",
      };
    }

    return {
      ...base,
      pickedIndex: opts.requestedIndex,
      picked: {
        index: opts.requestedIndex,
        text: preview.text,
        visible: preview.visible,
        selectorHint: preview.selectorHint,
      },
      rejected: [],
      rejectedTruncated: false,
      reason: null,
    };
  }

  if (!opts.visibleOnly) {
    const preview = await opts.previewAt(0);
    return {
      ...base,
      pickedIndex: 0,
      picked: {
        index: 0,
        text: preview.text,
        visible: preview.visible,
        selectorHint: preview.selectorHint,
      },
      rejected: [],
      rejectedTruncated: false,
      reason: null,
    };
  }

  // visibleOnly selection: choose the first visible match across frames.
  let pickedIndex: number | null = null;
  let offset = 0;
  for (const entry of opts.perFrameCounts) {
    if (typeof entry.firstVisibleIndex === "number") {
      pickedIndex = offset + entry.firstVisibleIndex;
      break;
    }
    offset += entry.rawCount;
  }

  const rejected: TargetClickExplainReport["rejected"] = [];
  let rejectedTruncated = false;
  const stopExclusive = pickedIndex ?? opts.matchCount;
  let frameOffset = 0;

  for (const entry of opts.perFrameCounts) {
    if (rejected.length >= CLICK_EXPLAIN_MAX_REJECTED) {
      rejectedTruncated = true;
      break;
    }
    if (frameOffset >= stopExclusive) {
      break;
    }

    const stopInFrame = Math.min(entry.rawCount, stopExclusive - frameOffset);
    if (stopInFrame <= 0) {
      frameOffset += entry.rawCount;
      continue;
    }

    const payload = await opts.listRejectedInvisible({
      frameCdpId: entry.frameCdpId,
      stopExclusive: stopInFrame,
      maxRejected: Math.max(0, CLICK_EXPLAIN_MAX_REJECTED - rejected.length),
    });

    for (const item of payload.rejected) {
      if (rejected.length >= CLICK_EXPLAIN_MAX_REJECTED) {
        rejectedTruncated = true;
        break;
      }
      rejected.push({
        index: frameOffset + item.index,
        reason: "not_visible",
        visible: item.visible,
        text: item.text,
        selectorHint: item.selectorHint,
      });
    }
    rejectedTruncated = rejectedTruncated || payload.rejectedTruncated;
    frameOffset += entry.rawCount;
  }

  if (pickedIndex === null) {
    rejectedTruncated = rejectedTruncated || opts.matchCount > rejected.length;
    return {
      ...base,
      pickedIndex: null,
      picked: null,
      rejected,
      rejectedTruncated,
      reason: "no_visible_match",
    };
  }

  const picked = await opts.previewAt(pickedIndex);
  return {
    ...base,
    pickedIndex,
    picked: {
      index: pickedIndex,
      text: picked.text,
      visible: picked.visible,
      selectorHint: picked.selectorHint,
    },
    rejected,
    rejectedTruncated,
    reason: null,
  };
}
