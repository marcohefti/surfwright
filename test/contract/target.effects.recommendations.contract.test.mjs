import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-effects-reco-"));

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

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target hover requires query before session resolution", () => {
  const result = runCli(["target",
    "hover",
    "ABCDEF123456",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target motion-detect requires selector before session resolution", () => {
  const result = runCli(["target",
    "motion-detect",
    "ABCDEF123456",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target transition-assert validates cycle bounds", () => {
  const result = runCli(["target",
    "transition-assert",
    "ABCDEF123456",
    "--cycles",
    "0",
    "--click-selector",
    "#btn",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target scroll-reveal-scan validates two-step minimum", () => {
  const result = runCli(["target",
    "scroll-reveal-scan",
    "ABCDEF123456",
    "--steps",
    "0",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target sticky-check validates step shape before session resolution", () => {
  const result = runCli(["target",
    "sticky-check",
    "ABCDEF123456",
    "--steps",
    "0,bad,100",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

