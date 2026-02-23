#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    budgetPath: path.join(process.cwd(), "test", "fixtures", "perf", "zcl-efficiency-budgets.json"),
    runDirs: [],
    attemptDirs: [],
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--budget") {
      const value = argv[i + 1];
      if (!value) {
        fail("zcl-efficiency: --budget requires a path");
      }
      out.budgetPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (token === "--run") {
      const value = argv[i + 1];
      if (!value) {
        fail("zcl-efficiency: --run requires a path");
      }
      out.runDirs.push(path.resolve(process.cwd(), value));
      i += 1;
      continue;
    }
    if (token === "--attempt") {
      const value = argv[i + 1];
      if (!value) {
        fail("zcl-efficiency: --attempt requires a path");
      }
      out.attemptDirs.push(path.resolve(process.cwd(), value));
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
          "Usage: node scripts/zcl/check-efficiency-budgets.mjs [options]",
          "",
          "Options:",
          "  --budget <path>    Budget file path (default: test/fixtures/perf/zcl-efficiency-budgets.json)",
          "  --run <path>       ZCL run dir (repeatable)",
          "  --attempt <path>   ZCL attempt dir (repeatable)",
          "  --json             JSON report output",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
    fail(`zcl-efficiency: unknown argument ${token}`);
  }

  return out;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function listAttemptDirsFromRun(runDir) {
  const attemptsRoot = path.join(runDir, "attempts");
  if (!fs.existsSync(attemptsRoot)) {
    return [];
  }
  return fs
    .readdirSync(attemptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(attemptsRoot, entry.name))
    .sort();
}

function readOutputDeltaChars(toolCallsPath) {
  if (!fs.existsSync(toolCallsPath)) {
    return 0;
  }
  const raw = fs.readFileSync(toolCallsPath, "utf8");
  if (!raw.trim()) {
    return 0;
  }

  let total = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.op !== "item_commandexecution_outputdelta") {
      continue;
    }
    const delta = entry?.input?.payload?.delta;
    if (typeof delta === "string") {
      total += delta.length;
    }
  }

  return total;
}

function evaluateAttempt(attemptDir, limits) {
  const reportPath = path.join(attemptDir, "attempt.report.json");
  if (!fs.existsSync(reportPath)) {
    return {
      attemptDir,
      ok: false,
      missionId: null,
      violations: ["missing attempt.report.json"],
      observed: {},
      limits,
    };
  }

  const report = readJson(reportPath);
  const metrics = report?.metrics ?? {};
  const op = metrics?.toolCallsByOp ?? {};

  const observed = {
    toolCallsTotal: Number(metrics?.toolCallsTotal ?? 0),
    totalTokens: Number(report?.tokenEstimates?.totalTokens ?? 0),
    failuresTotal: Number(metrics?.failuresTotal ?? 0),
    retriesTotal: Number(metrics?.retriesTotal ?? 0),
    timeoutsTotal: Number(metrics?.timeoutsTotal ?? 0),
    wallTimeMs: Number(metrics?.wallTimeMs ?? 0),
    execCommandBegin: Number(op?.exec_command_begin ?? 0),
    commandOutputDeltaChars: readOutputDeltaChars(path.join(attemptDir, "tool.calls.jsonl")),
  };

  const checks = [
    ["maxToolCallsTotal", observed.toolCallsTotal],
    ["maxTotalTokens", observed.totalTokens],
    ["maxFailuresTotal", observed.failuresTotal],
    ["maxRetriesTotal", observed.retriesTotal],
    ["maxTimeoutsTotal", observed.timeoutsTotal],
    ["maxWallTimeMs", observed.wallTimeMs],
    ["maxExecCommandBegin", observed.execCommandBegin],
    ["maxCommandOutputDeltaChars", observed.commandOutputDeltaChars],
  ];

  const violations = [];
  for (const [limitKey, value] of checks) {
    const limit = limits[limitKey];
    if (typeof limit !== "number") {
      continue;
    }
    if (value > limit) {
      violations.push(`${limitKey}: ${value} > ${limit}`);
    }
  }

  return {
    attemptDir,
    missionId: report?.missionId ?? null,
    attemptId: report?.attemptId ?? null,
    ok: violations.length === 0,
    violations,
    observed,
    limits,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.budgetPath)) {
    fail(`zcl-efficiency: budget file not found: ${args.budgetPath}`);
  }

  const budget = readJson(args.budgetPath);
  if (budget?.schemaVersion !== 1 || typeof budget !== "object" || budget === null) {
    fail("zcl-efficiency: invalid budget file format");
  }

  const defaults = typeof budget.defaults === "object" && budget.defaults ? budget.defaults : {};
  const byMission = typeof budget.missions === "object" && budget.missions ? budget.missions : {};

  const attemptDirs = new Set();
  for (const attemptDir of args.attemptDirs) {
    attemptDirs.add(attemptDir);
  }
  for (const runDir of args.runDirs) {
    for (const attemptDir of listAttemptDirsFromRun(runDir)) {
      attemptDirs.add(attemptDir);
    }
  }

  if (attemptDirs.size === 0) {
    fail("zcl-efficiency: provide at least one --run or --attempt path");
  }

  const results = [];
  for (const attemptDir of [...attemptDirs].sort()) {
    const reportPath = path.join(attemptDir, "attempt.report.json");
    let missionId = null;
    if (fs.existsSync(reportPath)) {
      missionId = readJson(reportPath)?.missionId ?? null;
    }
    const missionLimits = missionId && byMission[missionId] && typeof byMission[missionId] === "object" ? byMission[missionId] : {};
    const mergedLimits = { ...defaults, ...missionLimits };
    results.push(evaluateAttempt(attemptDir, mergedLimits));
  }

  const ok = results.every((result) => result.ok);
  const summary = {
    attempts: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok, summary, results }, null, 2)}\n`);
  } else if (ok) {
    process.stdout.write(`zcl-efficiency: PASS (${summary.passed}/${summary.attempts} attempts)\n`);
  } else {
    process.stdout.write(`zcl-efficiency: FAIL (${summary.failed}/${summary.attempts} attempts)\n`);
    for (const result of results) {
      if (result.ok) {
        continue;
      }
      const label = result.attemptId ?? path.basename(result.attemptDir);
      process.stdout.write(`- ${label}: ${result.violations.join("; ")}\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
