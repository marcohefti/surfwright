import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TEST_TIMEOUT_MS = 120_000;

async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
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
  { stdio: "inherit", cwd: repoRoot },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
