import fs from "node:fs";

export function parseFeedbackResult(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function emptyTraceStats() {
  return {
    execCommandBegin: 0,
    mcpToolCallBegin: 0,
    chromeDevtoolsCalls: 0,
    surfwrightCliCalls: 0,
    headedBrowserModeCalls: 0,
    commandOutputDeltaChars: 0,
    surfwrightSubcommands: {},
    chromeTools: {},
    commandEvents: [],
  };
}

function extractExecCommand(ev) {
  const arr = ev?.input?.payload?.msg?.command;
  if (!Array.isArray(arr) || arr.length === 0) {
    return "";
  }
  if (arr[0] === "/bin/zsh" && arr[1] === "-lc" && typeof arr[2] === "string") {
    return arr[2].trim();
  }
  return arr.join(" ").trim();
}

function extractSurfwrightSubcommand(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith("surfwright")) {
    return "";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return "";
  }
  const first = parts[1];
  const second = parts[2] || "";
  if (first === "--agent-id" || first.startsWith("--")) {
    return second || "unknown";
  }
  return first;
}

export function parseTraceStats(toolCallsPath, missionId, attemptId) {
  if (!fs.existsSync(toolCallsPath)) {
    return emptyTraceStats();
  }

  const stats = emptyTraceStats();
  const lines = fs.readFileSync(toolCallsPath, "utf8").split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }

    if (ev.op === "exec_command_begin") {
      stats.execCommandBegin += 1;
      const cmd = extractExecCommand(ev);
      if (cmd && /^surfwright(\s|$)/.test(cmd)) {
        stats.surfwrightCliCalls += 1;
        if (/(^|\s)--browser-mode\s+headed(\s|$)/.test(cmd)) {
          stats.headedBrowserModeCalls += 1;
        }
        const sub = extractSurfwrightSubcommand(cmd);
        if (sub) {
          stats.surfwrightSubcommands[sub] = (stats.surfwrightSubcommands[sub] || 0) + 1;
        }
      }
    }

    if (ev.op === "mcp_tool_call_begin") {
      stats.mcpToolCallBegin += 1;
      const inv = ev?.input?.payload?.msg?.invocation || {};
      const server = String(inv.server || "").trim();
      const tool = String(inv.tool || "").trim();
      if (server === "chrome-devtools") {
        stats.chromeDevtoolsCalls += 1;
        if (tool) {
          stats.chromeTools[tool] = (stats.chromeTools[tool] || 0) + 1;
        }
      }
    }

    if (ev.op === "item_commandexecution_outputdelta") {
      const delta = ev?.input?.payload?.delta;
      if (typeof delta === "string") {
        stats.commandOutputDeltaChars += delta.length;
      }
    }

    if (ev.op === "item_completed") {
      const item = ev?.input?.payload?.item;
      if (item?.type === "commandExecution") {
        stats.commandEvents.push({
          missionId,
          attemptId,
          durationMs: Number(item.durationMs || 0),
          exitCode: Number(item.exitCode ?? 0),
          command: String(item.command || ""),
        });
      }
    }
  }

  return stats;
}

export function mergeCounts(dst, src) {
  for (const [k, v] of Object.entries(src || {})) {
    dst[k] = (dst[k] || 0) + Number(v || 0);
  }
}

export function sortCountMap(mapObj) {
  return Object.entries(mapObj || {})
    .map(([key, count]) => ({ key, count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function sum(values) {
  return values.reduce((acc, v) => acc + Number(v || 0), 0);
}

function percentile(sorted, p) {
  if (!sorted.length) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const weight = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

export function summarizeNumeric(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const count = sorted.length;
  const total = sum(sorted);
  return {
    count,
    total,
    avg: count ? total / count : 0,
    min: count ? sorted[0] : 0,
    max: count ? sorted[count - 1] : 0,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
  };
}

export function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function round(value) {
  const n = Number(value || 0);
  return Math.round(n * 100) / 100;
}

export function buildMarkdown(metrics) {
  const lines = [];
  const flowSelection = metrics.flowSelection || {};
  const flowIds = Array.isArray(flowSelection.flowIds) ? flowSelection.flowIds : [];
  lines.push("# SurfWright Iteration Metrics");
  lines.push("");
  lines.push(`- label: \`${metrics.label || ""}\``);
  lines.push(`- campaignId: \`${metrics.campaign.campaignId}\``);
  lines.push(`- runId: \`${metrics.campaign.runId}\``);
  lines.push(`- status: \`${metrics.campaign.status}\``);
  lines.push(`- missionsCompleted: \`${metrics.campaign.missionsCompleted}/${metrics.campaign.totalMissions}\``);
  if (flowIds.length > 0) {
    lines.push(`- flows: \`${flowIds.join(",")}\``);
  }
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push("| metric | value |");
  lines.push("|---|---:|");
  lines.push(`| attempts | ${metrics.aggregate.attempts} |`);
  lines.push(`| verified ok | ${metrics.aggregate.verifiedOk} |`);
  lines.push(`| mismatch count | ${metrics.aggregate.mismatchCount} |`);
  lines.push(`| timeouts total | ${metrics.aggregate.timeoutsTotal} |`);
  lines.push(`| retries total | ${metrics.aggregate.retriesTotal} |`);
  lines.push(`| wall time total ms | ${round(metrics.aggregate.wallTimeMs.total)} |`);
  lines.push(`| tokens total | ${round(metrics.aggregate.tokens.total)} |`);
  lines.push(`| tool calls total | ${round(metrics.aggregate.toolCalls.total)} |`);
  lines.push(`| reasoning items total | ${round(metrics.aggregate.reasoningItems.total)} |`);
  lines.push(`| commentary messages total | ${round(metrics.aggregate.commentaryMessages.total)} |`);
  lines.push(`| exec calls total | ${metrics.aggregate.actionable.execCommandBeginTotal} |`);
  lines.push(`| mcp tool calls total | ${metrics.aggregate.actionable.mcpToolCallBeginTotal} |`);
  lines.push(`| surfwright cli calls total | ${metrics.aggregate.actionable.surfwrightCliCallsTotal} |`);
  lines.push(`| headed browser calls total | ${metrics.aggregate.actionable.headedBrowserModeCallsTotal} |`);
  lines.push("");
  lines.push("## Mission Table");
  lines.push("");
  lines.push("| flowId | slot | missionId | status | verified | wall ms | tokens | tool calls | reasoning | commentary | exec | surf cli | headed | mcp | output chars |");
  lines.push("|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const mission of metrics.missions) {
    lines.push(
      `| ${mission.flowId || ""} | ${mission.agentSlot || 0} | ${mission.missionId} | ${mission.status} | ${mission.verifiedOk} | ${mission.wallTimeMs} | ${mission.tokensTotal} | ${mission.toolCallsTotal} | ${mission.reasoningItems} | ${mission.commentaryMessages} | ${mission.trace.execCommandBegin} | ${mission.trace.surfwrightCliCalls} | ${mission.trace.headedBrowserModeCalls} | ${mission.trace.mcpToolCallBegin} | ${mission.trace.commandOutputDeltaChars} |`,
    );
  }
  lines.push("");
  lines.push("## SurfWright Subcommands");
  lines.push("");
  if (metrics.aggregate.actionable.topSurfwrightSubcommands.length === 0) {
    lines.push("- none");
  } else {
    for (const row of metrics.aggregate.actionable.topSurfwrightSubcommands) {
      lines.push(`- ${row.key}: ${row.count}`);
    }
  }
  lines.push("");
  lines.push("## Slowest Commands");
  lines.push("");
  if (metrics.topSlowCommands.length === 0) {
    lines.push("- none");
  } else {
    for (const row of metrics.topSlowCommands) {
      lines.push(`- [${row.flowId || "?"}|${row.missionId}] ${row.durationMs}ms :: ${row.commandPreview}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
