import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");

function walk(dir) {
  const entries = readdirSync(dir);
  const out = [];
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

test("browser contract tests must not spawn child processes directly (use cli-runner)", async () => {
  const browserRoot = join(repoRoot, "test", "browser");
  const allowed = new Set([
    "test/browser/helpers/cli-runner.mjs",
    "test/browser/helpers/managed-cleanup.mjs",
  ]);
  const files = walk(browserRoot).filter((p) => p.endsWith(".mjs"));

  const offenders = [];
  for (const filePath of files) {
    const rel = filePath.slice(repoRoot.length + 1).replaceAll("\\", "/");
    if (allowed.has(rel)) {
      continue;
    }

    const text = readFileSync(filePath, "utf8");
    const importsChildProcess = text.includes("node:child_process");
    const callsSpawnSync = /\bspawnSync\s*\(/.test(text);
    const callsSpawn = /\bspawn\s*\(/.test(text);
    if (importsChildProcess || callsSpawnSync || callsSpawn) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});
