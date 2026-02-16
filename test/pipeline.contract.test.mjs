import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-pipeline-"));

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

function runCliWithInput(args, input) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    input,
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

test("run executes deterministic multi-step pipeline", { skip: !hasBrowser() }, () => {
  const html = `
    <title>Pipeline Test</title>
    <main>
      <a id="blog-link" href="#blog">Blog</a>
      <h1 id="done">Ready</h1>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const planPath = path.join(TEST_STATE_DIR, "plan.json");
  const plan = {
    steps: [
      { id: "open", url: dataUrl, timeoutMs: 5000 },
      { id: "find", text: "Blog", timeoutMs: 5000, noPersist: true },
      { id: "click", text: "Blog", timeoutMs: 5000, waitForText: "Ready", snapshot: true, noPersist: true },
      { id: "eval", expression: "return document.title", timeoutMs: 5000, noPersist: true },
      { id: "wait", forSelector: "#done", timeoutMs: 5000, noPersist: true },
      { id: "snapshot", timeoutMs: 5000, noPersist: true },
    ],
  };
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const result = runCli(["--json", "run", "--plan", planPath, "--timeout-ms", "5000"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(typeof payload.sessionId, "string");
  assert.equal(typeof payload.targetId, "string");
  assert.equal(Array.isArray(payload.steps), true);
  assert.equal(payload.steps.length, 6);
  assert.equal(payload.steps[0].id, "open");
  assert.equal(payload.steps[1].id, "find");
  assert.equal(payload.steps[2].id, "click");
  assert.equal(payload.steps[3].id, "eval");
  assert.equal(payload.steps[4].id, "wait");
  assert.equal(payload.steps[5].id, "snapshot");
  assert.equal(typeof payload.totalMs, "number");
});

test("run doctor validates inline plan-json without browser execution", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "snapshot" },
    ],
  };
  const result = runCli(["--json", "run", "--doctor", "--plan-json", JSON.stringify(plan)]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
  assert.equal(payload.stepCount, 2);
  assert.equal(Array.isArray(payload.issues), true);
});

test("run doctor returns exit code 1 for lint-invalid plan", () => {
  const invalidPlan = {
    steps: [{ id: "open" }],
  };
  const result = runCli(["--json", "run", "--doctor", "--plan-json", JSON.stringify(invalidPlan)]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, false);
  assert.equal(payload.issues.some((entry) => entry.path === "steps[0].url"), true);
});

test("run doctor accepts stdin plan source", () => {
  const stdinPlan = {
    steps: [{ id: "open", url: "https://example.com", as: "open1" }],
  };
  const result = runCliWithInput(["--json", "run", "--doctor", "--plan", "-"], `${JSON.stringify(stdinPlan)}\n`);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor rejects invalid plan-json JSON with typed failure", () => {
  const result = runCli(["--json", "run", "--doctor", "--plan-json", "{"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(payload.message, "plan-json is not valid JSON");
});

test("run doctor rejects invalid plan file JSON with typed failure", () => {
  const planPath = path.join(TEST_STATE_DIR, "invalid-plan.json");
  fs.writeFileSync(planPath, "{", "utf8");
  const result = runCli(["--json", "run", "--doctor", "--plan", planPath]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(payload.message, `plan file ${planPath} is not valid JSON`);
});

test("run rejects invalid step shapes before session resolution", () => {
  const invalidShape = { steps: [null] };
  const result = runCli(["--json", "run", "--plan-json", JSON.stringify(invalidShape)]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(payload.message, "plan lint failed: steps[0] step must be an object");
});
