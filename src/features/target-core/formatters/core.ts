function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function printTargetCoreSuccess(report: unknown): boolean {
  if (!isRecord(report)) {
    return false;
  }

  if ("targets" in report && Array.isArray(report.targets)) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    process.stdout.write(`ok sessionId=${sessionId} targets=${report.targets.length}\n`);
    return true;
  }

  if ("matches" in report && Array.isArray(report.matches)) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const mode = typeof report.mode === "string" ? report.mode : "unknown";
    const count = typeof report.count === "number" ? report.count : 0;
    process.stdout.write(
      ["ok", `sessionId=${sessionId}`, `targetId=${targetId}`, `mode=${mode}`, `count=${count}`, `returned=${report.matches.length}`].join(" ") +
        "\n",
    );
    return true;
  }

  if ("chunkIndex" in report && "totalChunks" in report && "text" in report && typeof report.text === "string") {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const chunkIndex = typeof report.chunkIndex === "number" ? report.chunkIndex : "?";
    const totalChunks = typeof report.totalChunks === "number" ? report.totalChunks : "?";
    process.stdout.write(
      ["ok", `sessionId=${sessionId}`, `targetId=${targetId}`, `chunk=${chunkIndex}/${totalChunks}`, `chars=${report.text.length}`].join(" ") +
        "\n",
    );
    return true;
  }

  if ("value" in report) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const mode = typeof report.mode === "string" ? report.mode : "unknown";
    const value = typeof report.value === "string" ? report.value : "null";
    process.stdout.write(["ok", `sessionId=${sessionId}`, `targetId=${targetId}`, `mode=${mode}`, `value=${value}`].join(" ") + "\n");
    return true;
  }

  if ("clicked" in report && isRecord(report.clicked) && "actionId" in report) {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    const actionId = typeof report.actionId === "string" ? report.actionId : "unknown";
    const mode = typeof report.mode === "string" ? report.mode : "unknown";
    const clickedText = typeof report.clicked.text === "string" ? report.clicked.text : "";
    process.stdout.write(
      [
        "ok",
        `sessionId=${sessionId}`,
        `targetId=${targetId}`,
        `actionId=${actionId}`,
        `mode=${mode}`,
        `clicked=${clickedText.length > 0 ? clickedText : "(empty)"}`,
      ].join(" ") + "\n",
    );
    return true;
  }

  if ("url" in report && typeof report.url === "string") {
    const sessionId = typeof report.sessionId === "string" ? report.sessionId : "unknown";
    const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";
    process.stdout.write(["ok", `sessionId=${sessionId}`, `targetId=${targetId}`, `url=${report.url}`].join(" ") + "\n");
    return true;
  }

  return false;
}
