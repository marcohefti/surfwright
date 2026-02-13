#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

function parseArgv(argv) {
  const opts = {
    urls: [],
    runs: 3,
    captureMs: 2500,
    profile: "perf",
    timeoutMs: 12000,
    budgetPath: null,
    sessionId: null,
    stateDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url") {
      opts.urls.push(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (token === "--runs") {
      opts.runs = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }
    if (token === "--capture-ms") {
      opts.captureMs = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }
    if (token === "--profile") {
      opts.profile = argv[i + 1] ?? "perf";
      i += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      opts.timeoutMs = Number.parseInt(argv[i + 1] ?? "", 10);
      i += 1;
      continue;
    }
    if (token === "--budget") {
      opts.budgetPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--session") {
      opts.sessionId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--state-dir") {
      opts.stateDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
  }
  if (opts.urls.length === 0) {
    throw new Error("Provide at least one --url");
  }
  if (!Number.isFinite(opts.runs) || opts.runs < 1 || opts.runs > 50) {
    throw new Error("runs must be between 1 and 50");
  }
  return opts;
}

function runCli(args, env) {
  const started = performance.now();
  const result = spawnSync(process.execPath, ["dist/cli.js", "--json", ...args], {
    encoding: "utf8",
    env,
  });
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  let payload = null;
  try {
    payload = JSON.parse(result.stdout.trim());
  } catch {
    payload = null;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${args.join(" ")}): ${result.stdout || result.stderr}`);
  }
  return { elapsedMs, payload };
}

function p95(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? sorted[sorted.length - 1];
}

const options = parseArgv(process.argv.slice(2));
const stateDir = options.stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-perf-"));
const env = {
  ...process.env,
  SURFWRIGHT_STATE_DIR: stateDir,
};

const runs = [];
for (const url of options.urls) {
  for (let run = 1; run <= options.runs; run += 1) {
    const ensure = runCli(["session", "ensure", "--timeout-ms", String(options.timeoutMs)], env);
    const sessionId = options.sessionId ?? ensure.payload.sessionId;
    const open = runCli(["--session", sessionId, "open", url, "--timeout-ms", String(options.timeoutMs)], env);
    const targetId = open.payload.targetId;
    const network = runCli(
      [
        "--session",
        sessionId,
        "target",
        "network",
        targetId,
        "--profile",
        options.profile,
        "--view",
        "summary",
        "--capture-ms",
        String(options.captureMs),
        "--timeout-ms",
        String(options.timeoutMs),
      ],
      env,
    );

    let budget = null;
    if (typeof options.budgetPath === "string" && options.budgetPath.length > 0) {
      budget = runCli(
        [
          "--session",
          sessionId,
          "target",
          "network-check",
          targetId,
          "--budget",
          options.budgetPath,
          "--profile",
          options.profile,
          "--capture-ms",
          String(options.captureMs),
          "--timeout-ms",
          String(options.timeoutMs),
        ],
        env,
      ).payload;
    }

    runs.push({
      url,
      run,
      sessionId,
      targetId,
      commandMs: {
        ensure: ensure.elapsedMs,
        open: open.elapsedMs,
        network: network.elapsedMs,
      },
      metrics: {
        requests: network.payload.counts.requestsReturned,
        failed: network.payload.counts.failedSeen,
        p95LatencyMs: network.payload.performance.latencyMs.p95,
        bytesApproxTotal: network.payload.performance.bytesApproxTotal,
      },
      budget,
    });
  }
}

const networkDurations = runs.map((entry) => entry.commandMs.network);
const summary = {
  runs: runs.length,
  urls: options.urls.length,
  avgNetworkCommandMs: Math.round((networkDurations.reduce((acc, value) => acc + value, 0) / networkDurations.length) * 100) / 100,
  p95NetworkCommandMs: p95(networkDurations),
  avgRequests: Math.round((runs.reduce((acc, value) => acc + value.metrics.requests, 0) / runs.length) * 100) / 100,
  avgP95LatencyMs:
    Math.round(
      (runs.reduce((acc, value) => acc + (typeof value.metrics.p95LatencyMs === "number" ? value.metrics.p95LatencyMs : 0), 0) /
        runs.length) *
        100,
    ) / 100,
};

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      stateDir,
      options: {
        runs: options.runs,
        profile: options.profile,
        captureMs: options.captureMs,
        timeoutMs: options.timeoutMs,
        urls: options.urls,
      },
      summary,
      runs,
    },
    null,
    2,
  )}\n`,
);
