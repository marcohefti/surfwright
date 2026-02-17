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

test("browser contract tests must not depend on external URLs (local fixtures only)", async () => {
  const browserRoot = join(repoRoot, "test", "browser");
  const files = walk(browserRoot).filter((p) => p.endsWith(".browser.mjs"));
  const allowedPrefixes = ["http://127.0.0.1", "http://localhost", "http://[::1]"];

  /** @type {Array<{ file: string; url: string }>} */
  const offenders = [];
  for (const filePath of files) {
    const rel = filePath.slice(repoRoot.length + 1).replaceAll("\\", "/");
    const text = readFileSync(filePath, "utf8");
    const matches = text.match(/https?:\/\/[^\s"'`\)\]]+/g) ?? [];
    for (const url of matches) {
      if (allowedPrefixes.some((prefix) => url.startsWith(prefix))) {
        continue;
      }
      offenders.push({ file: rel, url });
    }
  }

  assert.deepEqual(offenders, []);
});
