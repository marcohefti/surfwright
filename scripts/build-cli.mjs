import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const LOCK_PATH = path.resolve(".surfwright-build.lock");
const LOCK_TIMEOUT_MS = 180000;
const LOCK_RETRY_MS = 80;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryAcquireLock() {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, "utf8");
    fs.closeSync(fd);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_PATH, { force: true });
  } catch {
    // ignore
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (tryAcquireLock()) {
      return;
    }
    await sleep(LOCK_RETRY_MS);
  }
  throw new Error(`Timed out waiting for build lock: ${LOCK_PATH}`);
}

function runBuild() {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    pnpmCmd,
    ["exec", "tsup", "src/cli.ts", "--format", "esm", "--dts", "--clean", "--out-dir", "dist"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (typeof result.status === "number") {
    process.exitCode = result.status;
    return;
  }
  throw result.error ?? new Error("build failed");
}

await acquireLock();
try {
  runBuild();
} finally {
  releaseLock();
}
