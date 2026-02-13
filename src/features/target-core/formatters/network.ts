function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function printTargetNetworkSuccess(report: unknown): boolean {
  if (!isRecord(report)) {
    return false;
  }

  if ("capture" in report && isRecord(report.capture) && "counts" in report && isRecord(report.counts)) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const actionId = typeof report.actionId === "string" ? report.actionId : "none";
    const requests = typeof report.counts.requestsReturned === "number" ? report.counts.requestsReturned : 0;
    const responses = typeof report.counts.responsesSeen === "number" ? report.counts.responsesSeen : 0;
    const failed = typeof report.counts.failedSeen === "number" ? report.counts.failedSeen : 0;
    const websockets = typeof report.counts.webSocketsReturned === "number" ? report.counts.webSocketsReturned : 0;
    process.stdout.write(
      [
        "ok",
        `sessionId=${sessionId}`,
        `targetId=${targetId}`,
        `actionId=${actionId}`,
        `requests=${requests}`,
        `responses=${responses}`,
        `failed=${failed}`,
        `websockets=${websockets}`,
      ].join(" ") + "\n",
    );
    return true;
  }

  if ("checks" in report && Array.isArray(report.checks) && "passed" in report) {
    const source = isRecord(report.source) ? report.source : {};
    const kind = typeof source.kind === "string" ? source.kind : "unknown";
    const id = typeof source.id === "string" ? source.id : "unknown";
    const passed = report.passed === true ? "true" : "false";
    process.stdout.write(["ok", `source=${kind}`, `id=${id}`, `passed=${passed}`, `checks=${report.checks.length}`].join(" ") + "\n");
    return true;
  }

  if ("preset" in report && "rows" in report && Array.isArray(report.rows)) {
    const source = isRecord(report.source) ? report.source : {};
    const kind = typeof source.kind === "string" ? source.kind : "unknown";
    const id = typeof source.id === "string" ? source.id : "unknown";
    const preset = typeof report.preset === "string" ? report.preset : "unknown";
    const returned = typeof report.returned === "number" ? report.returned : report.rows.length;
    process.stdout.write(["ok", `source=${kind}:${id}`, `preset=${preset}`, `rows=${returned}`].join(" ") + "\n");
    return true;
  }

  if ("captureId" in report && "maxRuntimeMs" in report) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const captureId = typeof report.captureId === "string" ? report.captureId : "unknown";
    const actionId = typeof report.actionId === "string" ? report.actionId : "unknown";
    const status = typeof report.status === "string" ? report.status : "unknown";
    process.stdout.write(
      ["ok", `sessionId=${sessionId}`, `targetId=${targetId}`, `captureId=${captureId}`, `actionId=${actionId}`, `status=${status}`].join(
        " ",
      ) + "\n",
    );
    return true;
  }

  if ("artifact" in report && isRecord(report.artifact)) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const format = typeof report.format === "string" ? report.format : "unknown";
    const artifactPath = typeof report.artifact.path === "string" ? report.artifact.path : "unknown";
    const entries = typeof report.artifact.entries === "number" ? report.artifact.entries : 0;
    const bytes = typeof report.artifact.bytes === "number" ? report.artifact.bytes : 0;
    process.stdout.write(
      [
        "ok",
        `sessionId=${sessionId}`,
        `targetId=${targetId}`,
        `format=${format}`,
        `path=${artifactPath}`,
        `entries=${entries}`,
        `bytes=${bytes}`,
      ].join(" ") + "\n",
    );
    return true;
  }

  return false;
}
