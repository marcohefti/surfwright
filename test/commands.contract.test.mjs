import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-commands-contract-"));

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

function loadFixture(relativePath) {
  const fixturePath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("contract command matches fixture-backed command surface", () => {
  const result = runCli(["--json", "contract"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "surfwright");
  assert.equal(typeof payload.version, "string");
  assert.equal(Array.isArray(payload.commands), true);
  assert.equal(Array.isArray(payload.errors), true);

  const expectedCore = loadFixture("test/fixtures/contract/commands.core.json");
  const expectedNetwork = loadFixture("test/fixtures/contract/commands.network.json");
  const expectedExperimental = loadFixture("test/fixtures/contract/commands.experimental.json");
  const expectedErrors = loadFixture("test/fixtures/contract/errors.json");
  const commandById = new Map(payload.commands.map((entry) => [entry.id, entry]));

  for (const entry of [...expectedCore, ...expectedNetwork, ...expectedExperimental]) {
    const actual = commandById.get(entry.id);
    assert.notEqual(actual, undefined, `missing command ${entry.id}`);
    assert.equal(actual.usage.includes(entry.usageMustContain), true, `usage mismatch for ${entry.id}`);
  }

  const seenErrors = new Set(payload.errors.map((entry) => entry.code));
  for (const code of expectedErrors) {
    assert.equal(seenErrors.has(code), true, `missing error code ${code}`);
  }
});

