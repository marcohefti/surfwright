export function getCoreMetrics(metricsFull) {
  const aggregate = metricsFull?.aggregate || {};
  const actionable = aggregate?.actionable || {};

  return {
    attempts: Number(aggregate.attempts || 0),
    verifiedOk: Number(aggregate.verifiedOk || 0),
    mismatchCount: Number(aggregate.mismatchCount || 0),
    retriesTotal: Number(aggregate.retriesTotal || 0),
    timeoutsTotal: Number(aggregate.timeoutsTotal || 0),
    wallTimeMsTotal: Number(aggregate?.wallTimeMs?.total || 0),
    tokensTotal: Number(aggregate?.tokens?.total || 0),
    toolCallsTotal: Number(aggregate?.toolCalls?.total || 0),
    reasoningItemsTotal: Number(aggregate?.reasoningItems?.total || 0),
    commentaryMessagesTotal: Number(aggregate?.commentaryMessages?.total || 0),
    execCallsTotal: Number(actionable.execCommandBeginTotal || 0),
    mcpToolCallsTotal: Number(actionable.mcpToolCallBeginTotal || 0),
    surfwrightCliCallsTotal: Number(actionable.surfwrightCliCallsTotal || 0),
    headedBrowserModeCallsTotal: Number(actionable.headedBrowserModeCallsTotal || 0),
  };
}

export function buildDelta(current, previous) {
  if (!previous) {
    return {
      tokensPct: null,
      wallPct: null,
      toolCallsPct: null,
      verifiedDelta: null,
    };
  }

  const pct = (cur, prev) => {
    if (!Number.isFinite(prev) || prev === 0) {
      return null;
    }
    return (cur - prev) / prev;
  };

  return {
    tokensPct: pct(current.tokensTotal, previous.tokensTotal),
    wallPct: pct(current.wallTimeMsTotal, previous.wallTimeMsTotal),
    toolCallsPct: pct(current.toolCallsTotal, previous.toolCallsTotal),
    verifiedDelta: Number(current.verifiedOk || 0) - Number(previous.verifiedOk || 0),
  };
}
