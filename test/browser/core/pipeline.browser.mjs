import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-pipeline-browser-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

function runCli(args) {
  return runCliSync(args);
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

function requireBrowser() {
  const doctor = runCli(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
}

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

  const result = runCli(["run", "--plan", planPath, "--timeout-ms", "5000"]);
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

test("run --log-ndjson writes compact append-only run log", () => {
  requireBrowser();

  const html = `<title>NDJSON</title><main><h1 id="done">Ready</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const planPath = path.join(TEST_STATE_DIR, "plan-ndjson.json");
  const plan = {
    steps: [
      { id: "open", url: dataUrl, timeoutMs: 5000 },
      { id: "snapshot", timeoutMs: 5000, noPersist: true },
    ],
  };
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const logPath = path.join(TEST_STATE_DIR, "run.ndjson");
  const result = runCli(["run",
    "--plan",
    planPath,
    "--timeout-ms",
    "5000",
    "--log-ndjson",
    logPath,
    "--log-mode",
    "minimal",
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.logNdjson?.path, "string");
  assert.equal(fs.existsSync(logPath), true);
  const lines = fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.trim().length > 0);
  assert.equal(lines.length >= 3, true);
  assert.equal(lines.some((line) => JSON.parse(line).phase === "run.start"), true);
  assert.equal(lines.some((line) => JSON.parse(line).phase === "run.end"), true);
});

test("run executes fill and upload steps with deterministic step reports", () => {
  requireBrowser();

  const fixturePath = path.join(TEST_STATE_DIR, "pipeline-upload.txt");
  fs.writeFileSync(fixturePath, "pipeline upload fixture\n", "utf8");
  const html = `
    <title>Pipeline Fill Upload</title>
    <main>
      <input id="email" />
      <input id="upload" type="file" />
      <p id="status">ready</p>
      <script>
        const email = document.getElementById("email");
        const upload = document.getElementById("upload");
        const status = document.getElementById("status");
        email.addEventListener("input", () => {
          status.textContent = "filled:" + email.value;
        });
        upload.addEventListener("change", () => {
          const count = upload.files ? upload.files.length : 0;
          status.textContent = "uploaded:" + count;
        });
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const planPath = path.join(TEST_STATE_DIR, "plan-fill-upload.json");
  const plan = {
    steps: [
      { id: "open", url: dataUrl, timeoutMs: 5000 },
      { id: "fill", selector: "#email", value: "agent@example.com", waitForText: "filled:agent@example.com", timeoutMs: 5000, noPersist: true },
      { id: "upload", selector: "#upload", files: [fixturePath], waitForText: "uploaded:1", timeoutMs: 5000, noPersist: true },
      { id: "read", selector: "#status", timeoutMs: 5000, noPersist: true },
    ],
  };
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const isolatedStateDir = fs.mkdtempSync(path.join(TEST_STATE_DIR, "iso-upload-submit-"));
  const result = runCliSync(["run", "--plan", planPath, "--timeout-ms", "5000"], {
    env: { SURFWRIGHT_STATE_DIR: isolatedStateDir },
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.steps), true);
  assert.equal(payload.steps.length, 4);
  assert.equal(payload.steps[1].id, "fill");
  assert.equal(payload.steps[2].id, "upload");
  assert.equal(payload.steps[2].report.fileCount, 1);
  assert.equal(typeof payload.steps[3].report.text, "string");
  assert.equal(payload.steps[3].report.text.includes("uploaded:1"), true);
});

test("run upload step honors submitSelector and upload result verification options", () => {
  requireBrowser();

  const fixturePath = path.join(TEST_STATE_DIR, "pipeline-upload-submit.txt");
  fs.writeFileSync(fixturePath, "pipeline upload submit fixture\n", "utf8");
  const html = `
    <title>Pipeline Upload Submit</title>
    <main>
      <input id="upload" type="file" />
      <button id="submit" type="button">Submit Upload</button>
      <p id="status">ready</p>
      <script>
        const upload = document.getElementById("upload");
        const status = document.getElementById("status");
        upload.addEventListener("change", () => {
          const file = upload.files && upload.files[0] ? upload.files[0].name : "none";
          status.textContent = "selected:" + file;
        });
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const planPath = path.join(TEST_STATE_DIR, "plan-upload-submit-verify.json");
  const plan = {
    steps: [
      { id: "open", url: dataUrl, timeoutMs: 5000 },
      {
        id: "upload",
        selector: "#upload",
        files: [fixturePath],
        submitSelector: "#submit",
        expectUploadedFilename: "pipeline-upload-submit.txt",
        waitForText: "selected:",
        timeoutMs: 5000,
        noPersist: true,
      },
      { id: "read", selector: "#status", timeoutMs: 5000, noPersist: true },
    ],
  };
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const result = runCli(["run", "--plan", planPath, "--timeout-ms", "5000"]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.steps[1].id, "upload");
  assert.equal(payload.steps[1].report.submitted, true);
  assert.equal(payload.steps[1].report.uploadVerified, true);
  assert.equal(payload.steps[1].report.uploadedFilename, "pipeline-upload-submit.txt");
  assert.equal(payload.steps[2].report.text.includes("selected:pipeline-upload-submit.txt"), true);
});
