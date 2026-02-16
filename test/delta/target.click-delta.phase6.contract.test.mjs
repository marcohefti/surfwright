import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-delta-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

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

let hasBrowserCache;
function hasBrowser() {
  if (process.env.SURFWRIGHT_TEST_BROWSER !== "1") {
    return false;
  }
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }

  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
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
        // ignore already-dead process
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

test("target click --delta returns bounded evidence-based delta", { skip: !hasBrowser() }, () => {
  const openResult = runCli(["--json", "open", "https://getbootstrap.com/docs/5.3/components/modal/", "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickResult = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Launch demo modal",
    "--visible-only",
    "--wait-for-selector",
    "[aria-modal=\"true\"]",
    "--delta",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(clickResult.status, 0);
  const payload = parseJson(clickResult.stdout);

  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "actionId",
    "mode",
    "selector",
    "contains",
    "visibleOnly",
    "query",
    "matchCount",
    "pickedIndex",
    "clicked",
    "url",
    "title",
    "wait",
    "snapshot",
    "delta",
    "timingMs",
  ]);

  assert.equal(typeof payload.delta, "object");
  assert.equal(typeof payload.delta.before.url, "string");
  assert.equal(typeof payload.delta.after.url, "string");
  assert.equal(typeof payload.delta.before.title, "string");
  assert.equal(typeof payload.delta.after.title, "string");

  assert.equal(typeof payload.delta.before.focus, "object");
  assert.equal(typeof payload.delta.after.focus, "object");
  assert.ok(payload.delta.before.focus.selectorHint === null || typeof payload.delta.before.focus.selectorHint === "string");
  assert.ok(payload.delta.after.focus.selectorHint === null || typeof payload.delta.after.focus.selectorHint === "string");
  assert.ok(payload.delta.after.focus.text === null || typeof payload.delta.after.focus.text === "string");
  assert.equal(typeof payload.delta.after.focus.textTruncated, "boolean");

  assert.equal(typeof payload.delta.before.roleCounts, "object");
  assert.equal(typeof payload.delta.after.roleCounts, "object");
  assert.equal(typeof payload.delta.before.roleCounts.dialog, "number");
  assert.equal(typeof payload.delta.after.roleCounts.dialog, "number");
  assert.ok(payload.delta.after.roleCounts.dialog >= 1);

  assert.equal(typeof payload.delta.clickedAria, "object");
  assert.equal(typeof payload.delta.clickedAria.detachedAfter, "boolean");
  assert.equal(Array.isArray(payload.delta.clickedAria.attributes), true);
  assert.deepEqual(
    payload.delta.clickedAria.attributes.map((entry) => entry.name),
    [
      "aria-expanded",
      "aria-controls",
      "aria-hidden",
      "aria-modal",
      "aria-pressed",
      "aria-selected",
      "aria-checked",
      "aria-disabled",
    ],
  );
  for (const entry of payload.delta.clickedAria.attributes) {
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.before === null || typeof entry.before === "string");
    assert.ok(entry.after === null || typeof entry.after === "string");
  }
});
