import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-effects-"));

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

test("target scroll-plan validates steps before session resolution", () => {
  const result = runCli(["target",
    "scroll-plan",
    "ABCDEF123456",
    "--steps",
    "0,abc,50",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target scroll-plan validates count filters before session resolution", () => {
  const result = runCli(["target",
    "scroll-plan",
    "ABCDEF123456",
    "--count-contains",
    "item",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target transition-trace validates max-events before session resolution", () => {
  const result = runCli(["target",
    "transition-trace",
    "ABCDEF123456",
    "--max-events",
    "0",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target observe requires selector before session resolution", () => {
  const result = runCli(["target",
    "observe",
    "ABCDEF123456",
    "--property",
    "transform",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target scroll-sample validates steps before session resolution", () => {
  const result = runCli(["target",
    "scroll-sample",
    "ABCDEF123456",
    "--selector",
    "body",
    "--steps",
    "0,bad,10",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("target scroll-watch validates properties before session resolution", () => {
  const result = runCli(["target",
    "scroll-watch",
    "ABCDEF123456",
    "--selector",
    "body",
    "--properties",
    ",",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});
