import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const budgetPath = path.join(process.cwd(), "test", "fixtures", "perf", "startup-envelope.json");
const distCliPath = path.join(process.cwd(), "dist", "cli.js");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseArgs(argv) {
  const out = { json: false };
  for (const token of argv) {
    if (token === "--json") {
      out.json = true;
    }
  }
  return out;
}

const cliArgs = parseArgs(process.argv.slice(2));

if (!fs.existsSync(distCliPath)) {
  fail(`startup-envelope: missing ${distCliPath} (run pnpm -s build first)`);
  process.exit(1);
}

const budget = readJson(budgetPath);
if (budget.schemaVersion !== 1 || typeof budget.cases !== "object" || budget.cases === null) {
  throw new Error("startup-envelope: invalid budget file format");
}

const samples = typeof budget.samples === "number" && Number.isInteger(budget.samples) && budget.samples > 0 ? budget.samples : 3;
const stat = typeof budget.stat === "string" && budget.stat.length > 0 ? budget.stat : "median";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-startup-envelope-"));
process.on("exit", () => {
  try {
    fs.rmSync(stateDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

const cases = [
  { id: "contract", args: ["contract"] },
  { id: "doctor", args: ["doctor"] },
  { id: "skill-doctor", args: ["skill", "doctor"] },
];

const results = [];

for (const entry of cases) {
  const limits = budget.cases[entry.id];
  const maxMs = typeof limits?.maxMs === "number" && Number.isFinite(limits.maxMs) ? limits.maxMs : null;
  if (maxMs === null) {
    fail(`startup-envelope: missing/invalid maxMs for caseId=${entry.id}`);
    continue;
  }

  const timingsMs = [];
  let lastStatus = null;
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    const result = spawnSync(process.execPath, [distCliPath, ...entry.args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SURFWRIGHT_STATE_DIR: stateDir,
        SURFWRIGHT_DAEMON: "0",
      },
    });
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1e6;
    lastStatus = result.status;
    if (result.status !== 0) {
      const stderr = String(result.stderr || "").trim();
      fail(`startup-envelope: ${entry.id} exited ${result.status}${stderr ? `: ${stderr}` : ""}`);
      break;
    }
    timingsMs.push(elapsedMs);
  }

  const observedMs =
    timingsMs.length === 0
      ? null
      : stat === "median"
        ? median(timingsMs)
        : stat === "min"
          ? Math.min(...timingsMs)
          : stat === "max"
            ? Math.max(...timingsMs)
            : median(timingsMs);

  results.push({
    caseId: entry.id,
    args: entry.args,
    samples,
    stat,
    status: lastStatus,
    observedMs: observedMs === null ? null : Math.round(observedMs),
    maxMs: Math.round(maxMs),
    timingsMs: timingsMs.map((value) => Math.round(value)),
  });

  if (typeof observedMs === "number" && observedMs > maxMs) {
    fail(`startup-envelope: ${entry.id} ${Math.round(observedMs)}ms > ${Math.round(maxMs)}ms`);
  }
}

if (process.exitCode === 1) {
  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, results }, null, 2)}\n`);
  }
  process.exit(1);
}

if (cliArgs.json) {
  process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
} else {
  process.stdout.write(`startup-envelope: PASS (${results.length} cases)\n`);
}
