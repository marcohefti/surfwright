#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fail, readJson, readJsonMaybe } from "./lib/common.mjs";
import {
  buildMarkdown,
  mergeCounts,
  parseFeedbackResult,
  parseTraceStats,
  sortCountMap,
  sum,
  summarizeNumeric,
  toCsvValue,
} from "./lib/score-helpers.mjs";

const die = (message) => fail(message, "bench-score");

function parseArgs(argv) {
  const out = {
    statePath: "",
    flowId: "",
    flowPrefix: "",
    outDir: "",
    label: "",
    topSlow: 25,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--state") {
      out.statePath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : "";
      i += 1;
      continue;
    }
    if (token === "--flow") {
      out.flowId = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--flow-prefix") {
      out.flowPrefix = argv[i + 1] || out.flowPrefix;
      i += 1;
      continue;
    }
    if (token === "--out-dir") {
      out.outDir = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : "";
      i += 1;
      continue;
    }
    if (token === "--label") {
      out.label = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--top-slow") {
      const value = Number.parseInt(String(argv[i + 1] || ""), 10);
      if (!Number.isFinite(value) || value <= 0) {
        die("--top-slow requires a positive integer");
      }
      out.topSlow = value;
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
          "Usage: node scripts/bench/score-iteration.mjs --state <campaign.run.state.json> --out-dir <dir> [options]",
          "",
          "Options:",
          "  --flow <id>       Exact flow id to score",
          "  --flow-prefix <p> Score all flows where flowId = <p> or starts with <p>- (default: surfwright)",
          "  --label <text>    Optional label echoed in output",
          "  --top-slow <n>    Number of slow command events in summary (default: 25)",
          "  --json            Print compact summary JSON to stdout",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
    die(`unknown argument: ${token}`);
  }

  if (!out.statePath) {
    die("--state is required");
  }
  if (!out.outDir) {
    die("--out-dir is required");
  }
  if (out.flowId && out.flowPrefix) {
    die("use either --flow or --flow-prefix, not both");
  }
  if (!out.flowId && !out.flowPrefix) {
    out.flowPrefix = "surfwright";
  }
  if (!out.flowId && !out.flowPrefix) {
    die("flow selection missing (set --flow or --flow-prefix)");
  }

  return out;
}

function parseAgentSlot(flowId) {
  const text = String(flowId || "").trim();
  const match = text.match(/-a([0-9]+)$/);
  if (!match) {
    return 1;
  }
  const slot = Number.parseInt(match[1], 10);
  if (!Number.isFinite(slot) || slot <= 0) {
    return 1;
  }
  return slot;
}

function toFiniteNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function readBucketFromNode(node, key) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return null;
  }
  return toFiniteNumber(node[key]);
}

function readFailureBucketsFromSources(sources) {
  for (const source of sources) {
    const infraFailed = readBucketFromNode(source, "infraFailed");
    const oracleFailed = readBucketFromNode(source, "oracleFailed");
    const missionFailed = readBucketFromNode(source, "missionFailed");
    if (infraFailed == null && oracleFailed == null && missionFailed == null) {
      continue;
    }
    return {
      infraFailed: Math.max(0, Math.floor(infraFailed || 0)),
      oracleFailed: Math.max(0, Math.floor(oracleFailed || 0)),
      missionFailed: Math.max(0, Math.floor(missionFailed || 0)),
      source: "zcl",
    };
  }
  return null;
}

function inferFailureBucketsFromAttempts(attempts) {
  let infraFailed = 0;
  let oracleFailed = 0;
  let missionFailed = 0;

  for (const attempt of attempts) {
    if (attempt.verifiedOk) {
      continue;
    }
    const reasonCodes = new Set(Array.isArray(attempt.reasonCodes) ? attempt.reasonCodes.map(String) : []);
    const isInfra =
      attempt.status === "infra_failed" ||
      [...reasonCodes].some(
        (code) =>
          code.startsWith("ZCL_E_RUNTIME_") ||
          code.startsWith("ZCL_E_RUNNER_") ||
          code === "ZCL_E_SESSION_UNREACHABLE",
      );
    if (isInfra) {
      infraFailed += 1;
      continue;
    }
    const isOracle = [...reasonCodes].some((code) => code.startsWith("ZCL_E_CAMPAIGN_ORACLE_EVALUATION_"));
    if (isOracle) {
      oracleFailed += 1;
      continue;
    }
    missionFailed += 1;
  }

  return {
    infraFailed,
    oracleFailed,
    missionFailed,
    source: "derived",
  };
}

function resolveCampaignFailureBuckets(runState, attempts) {
  const buckets =
    readFailureBucketsFromSources([
      runState,
      runState?.metrics,
      runState?.summary,
      runState?.aggregate,
      runState?.failureBuckets,
      runState?.campaign,
    ]) ?? inferFailureBucketsFromAttempts(attempts);

  return buckets;
}

function resolveFlowFailureBuckets(flowRun, attempts) {
  const fromZcl = readFailureBucketsFromSources([
    flowRun,
    flowRun?.metrics,
    flowRun?.summary,
    flowRun?.aggregate,
    flowRun?.failureBuckets,
  ]);
  if (fromZcl) {
    return {
      ...fromZcl,
      flowId: String(flowRun?.flowId || ""),
    };
  }

  const flowId = String(flowRun?.flowId || "");
  const flowAttempts = attempts.filter((row) => row.flowId === flowId);
  const derived = inferFailureBucketsFromAttempts(flowAttempts);
  return {
    ...derived,
    flowId,
  };
}

function selectFlowRuns(runState, args) {
  const all = Array.isArray(runState.flowRuns) ? runState.flowRuns : [];
  if (args.flowId) {
    const exact = all.find((row) => String(row.flowId || "") === args.flowId);
    if (!exact) {
      const available = all.map((row) => String(row.flowId || "")).filter(Boolean);
      die(`flow not found in run state: ${args.flowId}; available: ${available.join(", ")}`);
    }
    return {
      selectionKind: "flow",
      flowSelector: args.flowId,
      selected: [exact],
    };
  }

  const prefix = String(args.flowPrefix || "").trim();
  const selected = all.filter((row) => {
    const flowId = String(row.flowId || "");
    return flowId === prefix || flowId.startsWith(`${prefix}-`);
  });

  if (selected.length === 0) {
    const available = all.map((row) => String(row.flowId || "")).filter(Boolean);
    die(`flow prefix not found in run state: ${prefix}; available: ${available.join(", ")}`);
  }

  return {
    selectionKind: "flow_prefix",
    flowSelector: prefix,
    selected,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.statePath)) {
    die(`state file not found: ${args.statePath}`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  const runState = readJson(args.statePath);
  const flowSelection = selectFlowRuns(runState, args);
  const selectedFlowRuns = flowSelection.selected;
  const selectedFlowIds = selectedFlowRuns.map((row) => String(row.flowId || ""));

  const attempts = [];
  const reasonCodes = {};
  const subcommands = {};
  const chromeTools = {};
  const commandEvents = [];

  for (const flowRun of selectedFlowRuns) {
    const flowId = String(flowRun.flowId || "");
    const agentSlot = parseAgentSlot(flowId);

    for (const a of flowRun.attempts || []) {
      const attemptDir = String(a.attemptDir || "");
      const report = readJsonMaybe(path.join(attemptDir, "attempt.report.json"));
      const feedback = readJsonMaybe(path.join(attemptDir, "feedback.json"));
      const oracle = readJsonMaybe(path.join(attemptDir, "oracle.verdict.json"));
      const trace = parseTraceStats(path.join(attemptDir, "tool.calls.jsonl"), String(a.missionId || ""), String(a.attemptId || ""));

      mergeCounts(subcommands, trace.surfwrightSubcommands);
      mergeCounts(chromeTools, trace.chromeTools);
      commandEvents.push(...trace.commandEvents.map((event) => ({
        ...event,
        flowId,
        agentSlot,
      })));

      const claimedOk = Boolean(report?.ok === true || feedback?.ok === true);
      const verifiedOk = Boolean(oracle?.ok === true && a.status === "valid");

      const attemptReasonCodes = new Set();
      for (const code of a.errors || []) {
        if (code) {
          attemptReasonCodes.add(String(code));
        }
      }
      for (const code of oracle?.reasonCodes || []) {
        if (code) {
          attemptReasonCodes.add(String(code));
        }
      }
      for (const code of attemptReasonCodes) {
        reasonCodes[code] = (reasonCodes[code] || 0) + 1;
      }

      attempts.push({
        flowId,
        agentSlot,
        missionIndex: Number(a.missionIndex ?? -1),
        missionId: String(a.missionId || report?.missionId || ""),
        attemptId: String(a.attemptId || report?.attemptId || ""),
        attemptDir,
        status: String(a.status || ""),
        claimedOk,
        verifiedOk,
        mismatch: claimedOk !== verifiedOk,
        reasonCodes: [...attemptReasonCodes].sort(),
        feedbackResult: parseFeedbackResult(feedback?.result),
        metrics: {
          wallTimeMs: Number(report?.metrics?.wallTimeMs || 0),
          toolCallsTotal: Number(report?.metrics?.toolCallsTotal || 0),
          failuresTotal: Number(report?.metrics?.failuresTotal || 0),
          retriesTotal: Number(report?.metrics?.retriesTotal || 0),
          timeoutsTotal: Number(report?.metrics?.timeoutsTotal || 0),
          turnsStarted: Number(report?.metrics?.toolCallsByOp?.turn_started || 0),
          commentaryMessages: Number(report?.nativeResult?.commentaryMessagesObserved || 0),
          reasoningItems: Number(report?.nativeResult?.reasoningItemsObserved || 0),
          tokensTotal: Number(report?.tokenEstimates?.totalTokens || 0),
          resultSource: String(report?.nativeResult?.resultSource || ""),
        },
        trace,
      });
    }
  }

  attempts.sort((x, y) => {
    if (x.missionIndex !== y.missionIndex) {
      return x.missionIndex - y.missionIndex;
    }
    if (x.flowId !== y.flowId) {
      return x.flowId.localeCompare(y.flowId);
    }
    return x.attemptId.localeCompare(y.attemptId);
  });

  const statusCounts = {
    valid: 0,
    invalid: 0,
    infra_failed: 0,
    skipped: 0,
    other: 0,
  };
  for (const attempt of attempts) {
    if (attempt.status in statusCounts) {
      statusCounts[attempt.status] += 1;
    } else {
      statusCounts.other += 1;
    }
  }

  const wallTimes = attempts.map((row) => row.metrics.wallTimeMs);
  const tokens = attempts.map((row) => row.metrics.tokensTotal);
  const toolCalls = attempts.map((row) => row.metrics.toolCallsTotal);
  const turns = attempts.map((row) => row.metrics.turnsStarted);
  const reasoning = attempts.map((row) => row.metrics.reasoningItems);
  const commentary = attempts.map((row) => row.metrics.commentaryMessages);

  const aggregate = {
    attempts: attempts.length,
    missionsCovered: new Set(attempts.map((row) => row.missionId)).size,
    statusCounts,
    verifiedOk: attempts.filter((row) => row.verifiedOk).length,
    claimedOk: attempts.filter((row) => row.claimedOk).length,
    mismatchCount: attempts.filter((row) => row.mismatch).length,
    retriesTotal: sum(attempts.map((row) => row.metrics.retriesTotal)),
    timeoutsTotal: sum(attempts.map((row) => row.metrics.timeoutsTotal)),
    wallTimeMs: summarizeNumeric(wallTimes),
    tokens: summarizeNumeric(tokens),
    toolCalls: summarizeNumeric(toolCalls),
    turns: summarizeNumeric(turns),
    reasoningItems: summarizeNumeric(reasoning),
    commentaryMessages: summarizeNumeric(commentary),
    actionable: {
      execCommandBeginTotal: sum(attempts.map((row) => row.trace.execCommandBegin)),
      mcpToolCallBeginTotal: sum(attempts.map((row) => row.trace.mcpToolCallBegin)),
      chromeDevtoolsCallsTotal: sum(attempts.map((row) => row.trace.chromeDevtoolsCalls)),
      surfwrightCliCallsTotal: sum(attempts.map((row) => row.trace.surfwrightCliCalls)),
      headedBrowserModeCallsTotal: sum(attempts.map((row) => row.trace.headedBrowserModeCalls)),
      commandOutputDeltaCharsTotal: sum(attempts.map((row) => row.trace.commandOutputDeltaChars)),
      topSurfwrightSubcommands: sortCountMap(subcommands),
      topChromeTools: sortCountMap(chromeTools),
    },
    topReasonCodes: sortCountMap(reasonCodes),
  };

  const campaignFailureBuckets = resolveCampaignFailureBuckets(runState, attempts);
  const flowFailureBuckets = selectedFlowRuns.map((flowRun) => resolveFlowFailureBuckets(flowRun, attempts));

  const missions = attempts.map((row) => ({
    flowId: row.flowId,
    agentSlot: row.agentSlot,
    missionIndex: row.missionIndex,
    missionId: row.missionId,
    status: row.status,
    verifiedOk: row.verifiedOk,
    claimedOk: row.claimedOk,
    mismatch: row.mismatch,
    wallTimeMs: row.metrics.wallTimeMs,
    tokensTotal: row.metrics.tokensTotal,
    toolCallsTotal: row.metrics.toolCallsTotal,
    retriesTotal: row.metrics.retriesTotal,
    timeoutsTotal: row.metrics.timeoutsTotal,
    turnsStarted: row.metrics.turnsStarted,
    reasoningItems: row.metrics.reasoningItems,
    commentaryMessages: row.metrics.commentaryMessages,
    trace: {
      execCommandBegin: row.trace.execCommandBegin,
      mcpToolCallBegin: row.trace.mcpToolCallBegin,
      surfwrightCliCalls: row.trace.surfwrightCliCalls,
      headedBrowserModeCalls: row.trace.headedBrowserModeCalls,
      chromeDevtoolsCalls: row.trace.chromeDevtoolsCalls,
      commandOutputDeltaChars: row.trace.commandOutputDeltaChars,
      surfwrightSubcommands: row.trace.surfwrightSubcommands,
      chromeTools: row.trace.chromeTools,
    },
    attemptDir: row.attemptDir,
    attemptId: row.attemptId,
    reasonCodes: row.reasonCodes,
  }));

  const topSlowCommands = commandEvents
    .filter((row) => row.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, args.topSlow)
    .map((row) => ({
      flowId: row.flowId,
      agentSlot: row.agentSlot,
      missionId: row.missionId,
      attemptId: row.attemptId,
      durationMs: row.durationMs,
      exitCode: row.exitCode,
      commandPreview: String(row.command || "").replace(/\s+/g, " ").slice(0, 220),
      command: row.command,
    }));

  const metrics = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    label: args.label,
    flowId: selectedFlowIds.length === 1 ? selectedFlowIds[0] : "",
    flowSelection: {
      kind: flowSelection.selectionKind,
      selector: flowSelection.flowSelector,
      flowIds: selectedFlowIds,
      flowCount: selectedFlowIds.length,
    },
    campaign: {
      campaignId: String(runState.campaignId || ""),
      runId: String(runState.runId || ""),
      status: String(runState.status || ""),
      totalMissions: Number(runState.totalMissions || 0),
      missionsCompleted: Number(runState.missionsCompleted || 0),
      gatesPassed: Number((runState.missionGates || []).filter((row) => row.ok === true).length),
      gatesFailed: Number((runState.missionGates || []).filter((row) => row.ok !== true).length),
      failureBuckets: {
        infraFailed: campaignFailureBuckets.infraFailed,
        oracleFailed: campaignFailureBuckets.oracleFailed,
        missionFailed: campaignFailureBuckets.missionFailed,
        source: campaignFailureBuckets.source,
      },
      flowFailureBuckets,
      outRoot: String(runState.outRoot || ""),
      specPath: String(runState.specPath || ""),
    },
    aggregate,
    missions,
    topSlowCommands,
    attemptRefs: attempts.map((row) => ({
      flowId: row.flowId,
      agentSlot: row.agentSlot,
      missionId: row.missionId,
      attemptId: row.attemptId,
      attemptDir: row.attemptDir,
    })),
  };

  const metricsJsonPath = path.join(args.outDir, "metrics.full.json");
  const metricsMdPath = path.join(args.outDir, "metrics.summary.md");
  const missionCsvPath = path.join(args.outDir, "mission.metrics.csv");
  const commandJsonPath = path.join(args.outDir, "trace.command-durations.json");

  fs.writeFileSync(metricsJsonPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  fs.writeFileSync(metricsMdPath, buildMarkdown(metrics), "utf8");

  const csvRows = [];
  csvRows.push(
    [
      "missionIndex",
      "flowId",
      "agentSlot",
      "missionId",
      "status",
      "verifiedOk",
      "wallTimeMs",
      "tokensTotal",
      "toolCallsTotal",
      "retriesTotal",
      "timeoutsTotal",
      "turnsStarted",
      "reasoningItems",
      "commentaryMessages",
      "execCommandBegin",
      "surfwrightCliCalls",
      "headedBrowserModeCalls",
      "mcpToolCallBegin",
      "commandOutputDeltaChars",
      "attemptId",
      "attemptDir",
    ].join(","),
  );
  for (const mission of missions) {
    csvRows.push(
      [
        mission.missionIndex,
        mission.flowId,
        mission.agentSlot,
        mission.missionId,
        mission.status,
        mission.verifiedOk,
        mission.wallTimeMs,
        mission.tokensTotal,
        mission.toolCallsTotal,
        mission.retriesTotal,
        mission.timeoutsTotal,
        mission.turnsStarted,
        mission.reasoningItems,
        mission.commentaryMessages,
        mission.trace.execCommandBegin,
        mission.trace.surfwrightCliCalls,
        mission.trace.headedBrowserModeCalls,
        mission.trace.mcpToolCallBegin,
        mission.trace.commandOutputDeltaChars,
        mission.attemptId,
        mission.attemptDir,
      ].map(toCsvValue).join(","),
    );
  }
  fs.writeFileSync(missionCsvPath, `${csvRows.join("\n")}\n`, "utf8");

  fs.writeFileSync(
    commandJsonPath,
    `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      topSlowCommands,
      allCommandEvents: commandEvents,
    }, null, 2)}\n`,
    "utf8",
  );

  const output = {
    ok: true,
    flowId: selectedFlowIds.length === 1 ? selectedFlowIds[0] : "",
    flowSelection: metrics.flowSelection,
    metricsJsonPath,
    metricsMdPath,
    missionCsvPath,
    commandJsonPath,
    aggregate: {
      attempts: aggregate.attempts,
      verifiedOk: aggregate.verifiedOk,
      mismatchCount: aggregate.mismatchCount,
      wallTimeMsTotal: aggregate.wallTimeMs.total,
      tokensTotal: aggregate.tokens.total,
      toolCallsTotal: aggregate.toolCalls.total,
      retriesTotal: aggregate.retriesTotal,
      timeoutsTotal: aggregate.timeoutsTotal,
      execCallsTotal: aggregate.actionable.execCommandBeginTotal,
      mcpToolCallsTotal: aggregate.actionable.mcpToolCallBeginTotal,
      surfwrightCliCallsTotal: aggregate.actionable.surfwrightCliCallsTotal,
      headedBrowserModeCallsTotal: aggregate.actionable.headedBrowserModeCallsTotal,
    },
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`bench-score: wrote ${metricsJsonPath}\n`);
    process.stdout.write(`bench-score: wrote ${metricsMdPath}\n`);
    process.stdout.write(`bench-score: wrote ${missionCsvPath}\n`);
    process.stdout.write(`bench-score: wrote ${commandJsonPath}\n`);
  }
}

main();
