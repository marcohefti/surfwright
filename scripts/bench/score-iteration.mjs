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
    flowId: "surfwright",
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
      out.flowId = argv[i + 1] || out.flowId;
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
          "  --flow <id>       Flow id to score (default: surfwright)",
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

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.statePath)) {
    die(`state file not found: ${args.statePath}`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  const runState = readJson(args.statePath);
  const flowRun = (runState.flowRuns || []).find((row) => row.flowId === args.flowId);
  if (!flowRun) {
    die(`flow not found in run state: ${args.flowId}`);
  }

  const attempts = [];
  const reasonCodes = {};
  const subcommands = {};
  const chromeTools = {};
  const commandEvents = [];

  for (const a of flowRun.attempts || []) {
    const attemptDir = String(a.attemptDir || "");
    const report = readJsonMaybe(path.join(attemptDir, "attempt.report.json"));
    const feedback = readJsonMaybe(path.join(attemptDir, "feedback.json"));
    const oracle = readJsonMaybe(path.join(attemptDir, "oracle.verdict.json"));
    const trace = parseTraceStats(path.join(attemptDir, "tool.calls.jsonl"), String(a.missionId || ""), String(a.attemptId || ""));

    mergeCounts(subcommands, trace.surfwrightSubcommands);
    mergeCounts(chromeTools, trace.chromeTools);
    commandEvents.push(...trace.commandEvents);

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

  attempts.sort((x, y) => x.missionIndex - y.missionIndex);

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

  const missions = attempts.map((row) => ({
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
    flowId: args.flowId,
    campaign: {
      campaignId: String(runState.campaignId || ""),
      runId: String(runState.runId || ""),
      status: String(runState.status || ""),
      totalMissions: Number(runState.totalMissions || 0),
      missionsCompleted: Number(runState.missionsCompleted || 0),
      gatesPassed: Number((runState.missionGates || []).filter((row) => row.ok === true).length),
      gatesFailed: Number((runState.missionGates || []).filter((row) => row.ok !== true).length),
      outRoot: String(runState.outRoot || ""),
      specPath: String(runState.specPath || ""),
    },
    aggregate,
    missions,
    topSlowCommands,
    attemptRefs: attempts.map((row) => ({
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
    flowId: args.flowId,
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
