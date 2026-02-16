import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-pipeline-browser-"));

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

function requireBrowser() {
  const doctor = runCli(["--json", "doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("run executes deterministic multi-step pipeline", () => {
  requireBrowser();

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

