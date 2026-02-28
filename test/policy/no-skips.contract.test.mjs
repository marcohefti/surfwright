import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function listContractTests(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "browser" || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      out.push(...listContractTests(full));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".contract.test.mjs")) {
      continue;
    }
    if (entry.name.includes(".browser.")) {
      continue;
    }
    out.push(full);
  }
  return out;
}

function listBrowserTests(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      out.push(...listBrowserTests(full));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".browser.mjs")) {
      continue;
    }
    out.push(full);
  }
  return out;
}

const patterns = [
  { id: "skip-option", re: /\{\s*skip\s*:/ },
  { id: "test-skip", re: /\btest\.skip\b/ },
  { id: "it-skip", re: /\bit\.skip\b/ },
  { id: "describe-skip", re: /\bdescribe\.skip\b/ },
];

function findSkipViolations(files) {
  const violations = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    for (const { id, re } of patterns) {
      const match = re.exec(text);
      if (!match) {
        continue;
      }
      const prior = text.slice(0, match.index);
      const line = prior.split("\n").length;
      violations.push(`${rel}:${line} (${id})`);
      break;
    }
  }
  return violations;
}

test("contract tests must not include skip markers (split into a separate lane instead)", () => {
  const root = path.resolve("test");
  const files = listContractTests(root);
  const violations = findSkipViolations(files);

  assert.equal(
    violations.length,
    0,
    `Found skip markers in contract tests (move them to test/browser/):\n${violations.join("\n")}`,
  );
});

test("browser tests must not include skip markers", () => {
  const root = path.resolve("test", "browser");
  const files = fs.existsSync(root) ? listBrowserTests(root) : [];
  const violations = findSkipViolations(files);
  assert.equal(violations.length, 0, `Found skip markers in browser tests:\n${violations.join("\n")}`);
});
