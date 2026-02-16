import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-frames-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_TEST_BROWSER: "1",
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const result = runCli(["--json", "doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

function cleanupManagedBrowsers() {
  try {
    const statePath = stateFilePath();
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object") {
        continue;
      }
      if (session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore already-dead processes
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers();
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target frames lists stable handles for MDN iframe fixture", () => {
  requireBrowser();
  const url = "https://mdn.github.io/dom-examples/channel-messaging-basic/";
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const framesResult = runCli(["--json", "target", "frames", openPayload.targetId, "--limit", "10", "--timeout-ms", "20000"]);
  assert.equal(framesResult.status, 0);
  const framesPayload = parseJson(framesResult.stdout);

  assert.deepEqual(Object.keys(framesPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "url",
    "title",
    "count",
    "limit",
    "frames",
    "truncated",
    "timingMs",
  ]);
  assert.equal(framesPayload.ok, true);
  assert.equal(framesPayload.sessionId, openPayload.sessionId);
  assert.equal(framesPayload.sessionSource, "target-inferred");
  assert.equal(framesPayload.targetId, openPayload.targetId);
  assert.equal(framesPayload.url.startsWith("https://mdn.github.io/"), true);
  assert.equal(typeof framesPayload.title, "string");
  assert.equal(typeof framesPayload.count, "number");
  assert.equal(framesPayload.count >= 2, true);
  assert.equal(framesPayload.limit, 10);
  assert.equal(Array.isArray(framesPayload.frames), true);
  assert.equal(framesPayload.frames.length >= 2, true);
  assert.equal(typeof framesPayload.truncated, "boolean");

  assert.equal(framesPayload.frames[0].frameId, "f-0");
  assert.equal(framesPayload.frames[0].parentFrameId, null);
  assert.equal(framesPayload.frames[0].depth, 0);
  assert.equal(framesPayload.frames[0].isMain, true);

  for (let idx = 0; idx < framesPayload.frames.length; idx += 1) {
    assert.equal(framesPayload.frames[idx].frameId, `f-${idx}`);
  }
});

test("target eval can target a specific frame via --frame-id", () => {
  requireBrowser();
  const url = "https://mdn.github.io/dom-examples/channel-messaging-basic/";
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const framesResult = runCli(["--json", "target", "frames", openPayload.targetId, "--limit", "50", "--timeout-ms", "20000"]);
  assert.equal(framesResult.status, 0);
  const framesPayload = parseJson(framesResult.stdout);
  const targetFrame = framesPayload.frames.find((frame) => frame.isMain === false);
  assert.ok(targetFrame, "Expected at least one non-main frame");

  const setResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--frame-id",
    targetFrame.frameId,
    "--expr",
    "(document.body.setAttribute('data-surfwright-test','ok'), true)",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(setResult.status, 0);
  const setPayload = parseJson(setResult.stdout);
  assert.equal(setPayload.context.evaluatedFrameId, targetFrame.frameId);
  assert.equal(setPayload.result.type, "boolean");
  assert.equal(setPayload.result.value, true);

  const mainReadResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--expr",
    "document.body.getAttribute('data-surfwright-test')",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(mainReadResult.status, 0);
  const mainReadPayload = parseJson(mainReadResult.stdout);
  assert.equal(mainReadPayload.context.evaluatedFrameId, "f-0");
  assert.equal(mainReadPayload.result.type, "null");
  assert.equal(mainReadPayload.result.value, null);

  const frameReadResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--frame-id",
    targetFrame.frameId,
    "--expr",
    "document.body.getAttribute('data-surfwright-test')",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(frameReadResult.status, 0);
  const frameReadPayload = parseJson(frameReadResult.stdout);
  assert.equal(frameReadPayload.context.evaluatedFrameId, targetFrame.frameId);
  assert.equal(frameReadPayload.result.type, "string");
  assert.equal(frameReadPayload.result.value, "ok");
});
