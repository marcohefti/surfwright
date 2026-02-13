import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-effects-"));

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
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const result = runCli(["--json", "doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
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
      if (!session || typeof session !== "object" || session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers();
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test("target scroll-plan validates steps before session resolution", () => {
  const result = runCli([
    "--json",
    "target",
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

test("target transition-trace validates max-events before session resolution", () => {
  const result = runCli([
    "--json",
    "target",
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

test("target scroll-plan returns deterministic shape", { skip: !hasBrowser() }, () => {
  const html = `<title>Scroll Plan</title><main style="height:4000px"><h1>scroll-page</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const planResult = runCli([
    "--json",
    "target",
    "scroll-plan",
    openPayload.targetId,
    "--steps",
    "0,120,1200",
    "--settle-ms",
    "0",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(planResult.status, 0);
  const payload = parseJson(planResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.actionId, "string");
  assert.equal(Array.isArray(payload.steps), true);
  assert.equal(payload.steps.length, 3);
  assert.equal(typeof payload.maxScroll, "number");
  assert.equal(typeof payload.viewport.width, "number");
  assert.equal(typeof payload.viewport.height, "number");
  assert.equal(payload.steps[0].requestedY, 0);
  assert.equal(typeof payload.steps[2].achievedY, "number");
  assert.equal(typeof payload.steps[2].deltaY, "number");
});

test("target transition-trace captures transition events after click", { skip: !hasBrowser() }, () => {
  const html = `<!doctype html>
  <html><head><title>Transition Trace</title>
  <style>
    #box { opacity: 1; transition: opacity 0.2s ease; }
    body.faded #box { opacity: 0.2; }
  </style>
  </head><body>
  <div id="box">box</div>
  <button id="btn" onclick="document.body.classList.toggle('faded')">Toggle</button>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const traceResult = runCli([
    "--json",
    "target",
    "transition-trace",
    openPayload.targetId,
    "--click-selector",
    "#btn",
    "--capture-ms",
    "800",
    "--max-events",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(traceResult.status, 0);
  const payload = parseJson(traceResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.actionId, "string");
  assert.equal(typeof payload.captureMs, "number");
  assert.equal(typeof payload.maxEvents, "number");
  assert.equal(typeof payload.eventCount, "number");
  assert.equal(Array.isArray(payload.events), true);
  assert.equal(payload.trigger.mode, "selector");
  assert.equal(payload.trigger.query, "#btn");
  assert.equal(typeof payload.trigger.clicked.selectorHint, "string");
  assert.equal(payload.events.some((entry) => entry.kind === "transitionstart"), true);
  assert.equal(payload.events.some((entry) => entry.propertyName === "opacity"), true);
});
