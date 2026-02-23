#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildScopeId, resolveMissionSelection, scopePaths } from "./lib/run-iteration-support.mjs";
function fail(message) {
  process.stderr.write(`bench-history: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    historyPath: "",
    configPath: path.resolve(process.cwd(), "bench/agent-loop/config.json"),
    loopId: "",
    scopeId: "",
    missionId: "",
    missionIdsCsv: "",
    outMd: "",
    outJson: "",
    outBrief: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--history") {
      out.historyPath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.historyPath;
      i += 1;
      continue;
    }
    if (token === "--config") {
      out.configPath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.configPath;
      i += 1;
      continue;
    }
    if (token === "--loop-id") {
      out.loopId = argv[i + 1] || out.loopId;
      i += 1;
      continue;
    }
    if (token === "--scope-id") {
      out.scopeId = argv[i + 1] || out.scopeId;
      i += 1;
      continue;
    }
    if (token === "--mission-id") {
      out.missionId = argv[i + 1] || out.missionId;
      i += 1;
      continue;
    }
    if (token === "--mission-ids") {
      out.missionIdsCsv = argv[i + 1] || out.missionIdsCsv;
      i += 1;
      continue;
    }
    if (token === "--out-md") {
      out.outMd = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.outMd;
      i += 1;
      continue;
    }
    if (token === "--out-json") {
      out.outJson = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.outJson;
      i += 1;
      continue;
    }
    if (token === "--out-brief") {
      out.outBrief = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.outBrief;
      i += 1;
      continue;
    }
    if (token === "--json") {
      out.json = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/bench/summarize-history.mjs [options]",
          "",
          "Options:",
          "  --history <path>   History JSONL path (default: scope path)",
          "  --config <path>    Loop config path (default: bench/agent-loop/config.json)",
          "  --loop-id <id>     Loop id (default from config)",
          "  --scope-id <id>    Scope id (default from mission selection)",
          "  --mission-id <id>  Scope from one mission id",
          "  --mission-ids <csv> Scope from mission cluster",
          "  --out-md <path>    Result sheet markdown output path",
          "  --out-json <path>  Result sheet JSON output path",
          "  --out-brief <path> Next iteration brief output path",
          "  --json             Print compact result JSON",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
    fail(`unknown argument: ${token}`);
  }

  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore invalid row
    }
  }
  return out;
}

function pctDelta(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return (current - previous) / previous;
}

function fmtPct(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function diffLabel(value, unit = "") {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${unit}`;
}

function missionSetLabel(missionIds) {
  if (!Array.isArray(missionIds) || missionIds.length === 0) {
    return "";
  }
  if (missionIds.length === 1) {
    return missionIds[0];
  }
  return missionIds.join(",");
}

function classifyOutcome({ current, previous }) {
  if (!current) {
    return "failed";
  }
  if (!previous) {
    return "baseline";
  }

  const successPrev = previous.metrics.attempts > 0 ? previous.metrics.verifiedOk / previous.metrics.attempts : 0;
  const successCur = current.metrics.attempts > 0 ? current.metrics.verifiedOk / current.metrics.attempts : 0;
  const successDelta = successCur - successPrev;

  const tokenPct = pctDelta(current.metrics.tokensTotal, previous.metrics.tokensTotal) ?? 0;
  const wallPct = pctDelta(current.metrics.wallTimeMsTotal, previous.metrics.wallTimeMsTotal) ?? 0;
  const toolPct = pctDelta(current.metrics.toolCallsTotal, previous.metrics.toolCallsTotal) ?? 0;

  const improvedSignals = [tokenPct < -0.03, wallPct < -0.03, toolPct < -0.03].filter(Boolean).length;
  const regressedSignals = [tokenPct > 0.03, wallPct > 0.03, toolPct > 0.03].filter(Boolean).length;

  if (successDelta < 0) {
    return "regressed";
  }
  if (successDelta > 0 && regressedSignals === 0) {
    return "improved";
  }
  if (improvedSignals > 0 && regressedSignals === 0) {
    return "improved";
  }
  if (regressedSignals > 0 && improvedSignals === 0) {
    return "regressed";
  }
  return "mixed";
}

function describeDrivers(current, previous) {
  if (!current || !previous) {
    return "baseline";
  }

  const changes = [
    { key: "tokens", value: current.metrics.tokensTotal - previous.metrics.tokensTotal, render: (v) => diffLabel(v) },
    { key: "wallMs", value: current.metrics.wallTimeMsTotal - previous.metrics.wallTimeMsTotal, render: (v) => diffLabel(v, "ms") },
    { key: "toolCalls", value: current.metrics.toolCallsTotal - previous.metrics.toolCallsTotal, render: (v) => diffLabel(v) },
    { key: "execCalls", value: current.metrics.execCallsTotal - previous.metrics.execCallsTotal, render: (v) => diffLabel(v) },
    { key: "reasoning", value: current.metrics.reasoningItemsTotal - previous.metrics.reasoningItemsTotal, render: (v) => diffLabel(v) },
    { key: "commentary", value: current.metrics.commentaryMessagesTotal - previous.metrics.commentaryMessagesTotal, render: (v) => diffLabel(v) },
  ]
    .filter((row) => Number.isFinite(row.value) && row.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (changes.length === 0) {
    return "no measurable delta";
  }

  return changes
    .slice(0, 3)
    .map((row) => `${row.key} ${row.render(row.value)}`)
    .join("; ");
}

function buildResultSheetMarkdown(summary) {
  const lines = [];
  lines.push("# SurfWright Result Sheet");
  lines.push("");
  lines.push(`- loopId: \`${summary.loopId}\``);
  lines.push(`- scopeId: \`${summary.scopeId}\``);
  lines.push(`- missionSet: \`${missionSetLabel(summary.scopeMissionIds)}\``);
  lines.push(`- generatedAt: \`${summary.generatedAt}\``);
  lines.push(`- iterations: \`${summary.iterations.length}\``);
  lines.push("- mode: `one campaign per run, one mission scope per run, fresh agent per flow+mission attempt`");
  lines.push("");

  const baselineRefs = summary.config?.baselineReferences || {};
  lines.push("## Baseline References");
  lines.push("");
  lines.push(`- chrome-mcp metrics: \`${baselineRefs.chromeMcpMetricsJson || ""}\``);
  lines.push(`- prior surfwright summary: \`${baselineRefs.surfwrightCanarySummaryJson || ""}\``);
  lines.push("");

  lines.push("## Iterations");
  lines.push("");
  lines.push("| iter | agents | label | outcome | verified | tokens | wall ms | tools | dTokens vs prev | dWall vs prev | why (hypothesis) | change | evidence |");
  lines.push("|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|---|");
  for (const row of summary.iterations) {
    const verifiedCell = row.metrics.attempts > 0 ? `${row.metrics.verifiedOk}/${row.metrics.attempts}` : "-";
    lines.push(
      `| ${row.iteration} | ${row.agentsPerMission || 1} | ${row.label || ""} | ${row.outcome} | ${verifiedCell} | ${row.metrics.tokensTotal || 0} | ${row.metrics.wallTimeMsTotal || 0} | ${row.metrics.toolCallsTotal || 0} | ${fmtPct(row.deltas.vsPrev.tokensPct)} | ${fmtPct(row.deltas.vsPrev.wallPct)} | ${row.hypothesis || ""} | ${row.change || ""} | ${row.evidence || ""} |`,
    );
  }
  lines.push("");

  const latest = summary.latest;
  if (latest) {
    lines.push("## Latest Snapshot");
    lines.push("");
    lines.push(`- iteration: \`#${latest.iteration}\` (${latest.label || "unlabeled"})`);
    lines.push(`- agentsPerMission: \`${latest.agentsPerMission || 1}\``);
    lines.push(`- flowIds: \`${(latest.flowIds || []).join(",")}\``);
    lines.push(`- outcome: \`${latest.outcome}\``);
    lines.push(`- verified: \`${latest.metrics.verifiedOk}/${latest.metrics.attempts}\``);
    lines.push(`- tokens: \`${latest.metrics.tokensTotal}\``);
    lines.push(`- wall ms: \`${latest.metrics.wallTimeMsTotal}\``);
    lines.push(`- tool calls: \`${latest.metrics.toolCallsTotal}\``);
    lines.push(`- headed browser calls: \`${latest.metrics.headedBrowserModeCallsTotal || 0}\``);
    lines.push(`- run state: \`${latest.artifacts.runStatePath || ""}\``);
    lines.push(`- metrics: \`${latest.artifacts.metricsJsonPath || ""}\``);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildNextTaskMarkdown(summary) {
  const lines = [];
  const latest = summary.latest;

  lines.push("# Next Iteration Task");
  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push("- Use one mission scope and one new campaign for the next run.");
  lines.push("- Keep `agentsPerMission` explicit per scope (`bench/agent-loop/config.json` or `--agents-per-mission`).");
  lines.push("- Keep model pinned to gpt-5.3-codex-spark / medium / best_effort.");
  lines.push("- No commit/push unless explicitly requested.");
  lines.push("- Keep run artifacts under tmp/ only.");
  lines.push("");

  if (!latest) {
    lines.push("No successful iteration rows yet.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  const nextLabel = `exp-${String(latest.iteration + 1).padStart(2, "0")}`;
  const ids = summary.scopeMissionIds || [];
  const missionArg = ids.length === 1 ? `--mission-id ${ids[0]}` : `--mission-ids ${ids.join(",")}`;
  const agentsPerMission = Number(latest.agentsPerMission || summary.config?.agentsPerMission || 1);

  lines.push("## Latest");
  lines.push("");
  lines.push(`- scope: ${summary.scopeId}`);
  lines.push(`- missionSet: ${missionSetLabel(ids)}`);
  lines.push(`- outcome: ${latest.outcome}`);
  lines.push(`- evidence: ${latest.evidence}`);
  lines.push("");

  lines.push("## Next Command");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm bench:loop:run \\");
  lines.push(`  --label \"${nextLabel}\" \\`);
  lines.push(`  ${missionArg} \\`);
  lines.push(`  --agents-per-mission ${agentsPerMission} \\`);
  lines.push("  --hypothesis \"<why this should improve>\" \\");
  lines.push("  --change \"<what changed>\" \\");
  lines.push("  --tags <tag1>,<tag2>");
  lines.push(`node scripts/bench/summarize-history.mjs --scope-id ${summary.scopeId}`);
  lines.push("```");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function writeOutputs(args, summary) {
  fs.mkdirSync(path.dirname(args.outMd), { recursive: true });
  fs.mkdirSync(path.dirname(args.outJson), { recursive: true });
  fs.mkdirSync(path.dirname(args.outBrief), { recursive: true });

  fs.writeFileSync(args.outJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(args.outMd, buildResultSheetMarkdown(summary), "utf8");
  fs.writeFileSync(args.outBrief, buildNextTaskMarkdown(summary), "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readJsonMaybe(args.configPath) || {};
  const loopId = args.loopId || String(config.loopId || "");
  if (!loopId) {
    fail("loop id not provided and not found in config");
  }
  let missionIds;
  try {
    missionIds = resolveMissionSelection(config, args);
  } catch {
    missionIds = [];
  }
  const explicitScope = String(args.scopeId || "").trim();
  const explicitMissionSelection = Boolean(String(args.missionId || "").trim() || String(args.missionIdsCsv || "").trim());
  if (explicitScope && !explicitMissionSelection) {
    missionIds = [];
  }
  const scopeId = explicitScope || (missionIds.length > 0 ? buildScopeId(missionIds) : "");
  if (!scopeId) {
    fail("scope id not provided and mission selection unavailable");
  }
  const scoped = scopePaths(process.cwd(), scopeId, args.historyPath);
  args.historyPath = scoped.historyPath;
  args.outMd = args.outMd || scoped.outMd;
  args.outJson = args.outJson || scoped.outJson;
  args.outBrief = args.outBrief || scoped.outBrief;
  const historyAll = readJsonl(args.historyPath);
  const header = historyAll.find((row) => row && row.kind === "header" && String(row.scopeId || "") === scopeId);
  const headerMissionIds = Array.isArray(header?.missionIds) && header.missionIds.length > 0 ? header.missionIds.map((v) => String(v)) : (header?.missionId ? [String(header.missionId)] : []);
  const scopeMissionIds = missionIds.length > 0 ? missionIds : headerMissionIds;
  const rows = historyAll.filter((row) => row && row.kind === "iteration" && row.loopId === loopId).sort((a, b) => Number(a.iteration || 0) - Number(b.iteration || 0));
  if (rows.length === 0) {
    const empty = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      loopId,
      scopeId,
      scopeMissionIds,
      config,
      iterations: [],
      latest: null,
    };
    writeOutputs(args, empty);
    const output = {
      ok: true,
      loopId,
      scopeId,
      historyPath: args.historyPath,
      outJson: args.outJson,
      outMd: args.outMd,
      outBrief: args.outBrief,
      iterations: 0,
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      process.stdout.write(`bench-history: wrote ${args.outJson}\n`);
      process.stdout.write(`bench-history: wrote ${args.outMd}\n`);
      process.stdout.write(`bench-history: wrote ${args.outBrief}\n`);
    }
    return;
  }
  const normalized = rows.map((row) => ({
    iteration: Number(row.iteration || 0),
    iterationId: String(row.iterationId || ""),
    createdAt: String(row.createdAt || ""),
    scopeId: String(row.scopeId || scopeId),
    missionScopeType: String(row.missionScopeType || (Array.isArray(row.missionIds) && row.missionIds.length > 1 ? "cluster" : "single")),
    missionIds: Array.isArray(row.missionIds) && row.missionIds.length > 0 ? row.missionIds.map((v) => String(v)) : (row.missionId ? [String(row.missionId)] : scopeMissionIds),
    agentsPerMission: Number(row.agentsPerMission || (Array.isArray(row.flowIds) ? row.flowIds.length : 0) || 1),
    flowIds: Array.isArray(row.flowIds) ? row.flowIds.map((v) => String(v)) : [],
    label: String(row.label || ""),
    hypothesis: String(row.hypothesis || ""),
    change: String(row.change || ""),
    changeTags: Array.isArray(row.changeTags) ? row.changeTags.map((v) => String(v)) : [],
    runStatus: String(row.run?.status || row.status || ""),
    metrics: {
      attempts: Number(row.metrics?.attempts || 0),
      verifiedOk: Number(row.metrics?.verifiedOk || 0),
      mismatchCount: Number(row.metrics?.mismatchCount || 0),
      retriesTotal: Number(row.metrics?.retriesTotal || 0),
      timeoutsTotal: Number(row.metrics?.timeoutsTotal || 0),
      wallTimeMsTotal: Number(row.metrics?.wallTimeMsTotal || 0),
      tokensTotal: Number(row.metrics?.tokensTotal || 0),
      toolCallsTotal: Number(row.metrics?.toolCallsTotal || 0),
      reasoningItemsTotal: Number(row.metrics?.reasoningItemsTotal || 0),
      commentaryMessagesTotal: Number(row.metrics?.commentaryMessagesTotal || 0),
      execCallsTotal: Number(row.metrics?.execCallsTotal || 0),
      mcpToolCallsTotal: Number(row.metrics?.mcpToolCallsTotal || 0),
      surfwrightCliCallsTotal: Number(row.metrics?.surfwrightCliCallsTotal || 0),
      headedBrowserModeCallsTotal: Number(row.metrics?.headedBrowserModeCallsTotal || 0),
    },
    artifacts: {
      iterationDir: String(row.artifacts?.iterationDir || ""),
      metricsJsonPath: String(row.artifacts?.metricsJsonPath || ""),
      metricsMdPath: String(row.artifacts?.metricsMdPath || ""),
      runStatePath: String(row.artifacts?.runStatePath || ""),
    },
  }));
  let prev = null;
  for (const row of normalized) {
    if (row.metrics.attempts <= 0) {
      row.deltas = {
        vsPrev: { tokensPct: null, wallPct: null },
        vsBaseline: { tokensPct: null, wallPct: null },
      };
      row.outcome = "failed";
      row.evidence = "no metrics";
      continue;
    }

    const baseline = normalized.find((r) => r.metrics.attempts > 0) || null;
    row.deltas = {
      vsPrev: {
        tokensPct: prev ? pctDelta(row.metrics.tokensTotal, prev.metrics.tokensTotal) : null,
        wallPct: prev ? pctDelta(row.metrics.wallTimeMsTotal, prev.metrics.wallTimeMsTotal) : null,
      },
      vsBaseline: {
        tokensPct: baseline ? pctDelta(row.metrics.tokensTotal, baseline.metrics.tokensTotal) : null,
        wallPct: baseline ? pctDelta(row.metrics.wallTimeMsTotal, baseline.metrics.wallTimeMsTotal) : null,
      },
    };
    row.outcome = classifyOutcome({ current: row, previous: prev });
    row.evidence = describeDrivers(row, prev);
    prev = row;
  }

  const latest = [...normalized].reverse().find((row) => row.metrics.attempts > 0) || normalized[normalized.length - 1];

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    loopId,
    scopeId,
    scopeMissionIds: latest?.missionIds?.length ? latest.missionIds : scopeMissionIds,
    config,
    iterations: normalized,
    latest,
  };

  writeOutputs(args, summary);

  const output = {
    ok: true,
    loopId,
    scopeId,
    historyPath: args.historyPath,
    outJson: args.outJson,
    outMd: args.outMd,
    outBrief: args.outBrief,
    iterations: normalized.length,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`bench-history: wrote ${args.outJson}\n`);
    process.stdout.write(`bench-history: wrote ${args.outMd}\n`);
    process.stdout.write(`bench-history: wrote ${args.outBrief}\n`);
  }
}

main();
