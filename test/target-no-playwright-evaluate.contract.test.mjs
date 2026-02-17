import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

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

test("target subsystem must not use Playwright page/frame.evaluate (CDP realm bug guard)", async () => {
  const targetRoot = join(repoRoot, "src", "core", "target");
  const files = walk(targetRoot).filter((p) => p.endsWith(".ts"));
  const offenders = [];
  for (const filePath of files) {
    const rel = filePath.slice(repoRoot.length + 1);
    const text = readFileSync(filePath, "utf8");
    if (text.includes(".page.evaluate(") || text.includes(".frame.evaluate(") || text.includes("page.evaluate(") || text.includes("frame.evaluate(")) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});
