import { buildInsights, buildPerformanceSummary, buildTruncationHints, toTableRows } from "../target-network-analysis.js";
import { matchesRequestFilters, type ParsedNetworkInput } from "../target-network-utils.js";
import type { TargetNetworkReport } from "../../../../types.js";

export function applyCapturedView(raw: TargetNetworkReport, parsed: ParsedNetworkInput): TargetNetworkReport {
  const requests = raw.requests.filter((request) => matchesRequestFilters(request, parsed));
  const webSockets = parsed.urlContains ? raw.webSockets.filter((socket) => socket.url.includes(parsed.urlContains ?? "")) : raw.webSockets;
  const counts = {
    ...raw.counts,
    requestsReturned: requests.length,
    webSocketsReturned: webSockets.length,
    wsMessagesReturned: webSockets.reduce((acc, socket) => acc + socket.messages.length, 0),
  };
  return {
    ...raw,
    filters: {
      urlContains: parsed.urlContains,
      method: parsed.method,
      resourceType: parsed.resourceType,
      status: parsed.statusInput,
      failedOnly: parsed.failedOnly,
      profile: parsed.profile,
    },
    view: parsed.view,
    fields: parsed.fields,
    tableRows: parsed.view === "table" ? toTableRows(requests, parsed.fields) : [],
    counts,
    performance: buildPerformanceSummary(requests),
    hints: buildTruncationHints({
      droppedRequests: raw.counts.droppedRequests,
      droppedWebSockets: raw.counts.droppedWebSockets,
      droppedWsMessages: raw.counts.droppedWsMessages,
      maxRequests: raw.limits.maxRequests,
      maxWebSockets: raw.limits.maxWebSockets,
      maxWsMessages: raw.limits.maxWsMessages,
    }),
    insights: buildInsights(requests, webSockets),
    requests: parsed.view === "summary" ? [] : requests,
    webSockets: parsed.view === "summary" ? [] : webSockets,
  };
}

