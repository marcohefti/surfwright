import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const RUN_TMP_PREFIX = "surfwright-browser-tests-";

async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walk(p)));
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(".browser.mjs")) out.push(p);
  }
  return out;
}

function hasArg(argv, flagPrefix) {
  return argv.some((a) => a === flagPrefix || a.startsWith(`${flagPrefix}=`));
}

function escapeRegexLiteral(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const root = path.join(repoRoot, "test", "browser");
const files = (await walk(root)).sort();

if (files.length === 0) {
  console.error("run-browser-tests: no *.browser.mjs files found under test/browser");
  process.exitCode = 1;
  process.exit();
}

const forwarded = process.argv.slice(2);

const timeoutMs = Number.parseInt(
  process.env.SURFWRIGHT_BROWSER_TEST_TIMEOUT_MS ?? "",
  10,
);
const effectiveTimeoutMs = Number.isFinite(timeoutMs)
  ? timeoutMs
  : DEFAULT_TEST_TIMEOUT_MS;

const timeoutArgs = hasArg(forwarded, "--test-timeout")
  ? []
  : [`--test-timeout=${effectiveTimeoutMs}`];

const runTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), RUN_TMP_PREFIX));
let cleaned = false;

function cleanupRunTmpRoot() {
  if (cleaned) {
    return;
  }
  cleaned = true;

  // Best-effort: kill any Chrome helpers that still reference the test tmp root (usually --user-data-dir=...).
  if (process.platform !== "win32") {
    const escaped = escapeRegexLiteral(runTmpRoot);
    // Prefer user-data-dir scoping to avoid killing unrelated processes that might mention the path.
    const pattern = `user-data-dir=.*${escaped}`;
    try {
      spawnSync("pkill", ["-TERM", "-f", pattern], { stdio: "ignore" });
    } catch {
      // ignore
    }
    try {
      spawnSync("pkill", ["-KILL", "-f", pattern], { stdio: "ignore" });
    } catch {
      // ignore
    }
  }

  try {
    fs.rmSync(runTmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// Keep output minimal; a single line helps when diagnosing CI vs local differences.
console.log(
  `run-browser-tests: ${files.length} files, timeout=${timeoutArgs.length ? effectiveTimeoutMs : "custom"}`,
);

const child = spawn(
  process.execPath,
  [
    "--test",
    "--test-isolation=process",
    "--test-concurrency=1",
    ...timeoutArgs,
    ...forwarded,
    ...files,
  ],
  {
    stdio: "inherit",
    cwd: repoRoot,
    env: { ...process.env, SURFWRIGHT_TEST_TMPDIR: runTmpRoot },
    detached: process.platform !== "win32",
  },
);

function terminateChild(signal) {
  if (!child.pid || typeof child.pid !== "number") {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // ignore and try the pid directly
    }
  }
  try {
    process.kill(child.pid, signal);
  } catch {
    // ignore
  }
}

function onSignal(signal) {
  terminateChild(signal);
  cleanupRunTmpRoot();
  process.exitCode = 1;
  process.exit();
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGHUP", () => onSignal("SIGHUP"));
process.on("exit", () => cleanupRunTmpRoot());

child.on("exit", (code, signal) => {
  cleanupRunTmpRoot();
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
