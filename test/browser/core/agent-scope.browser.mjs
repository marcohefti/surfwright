import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_TARGET_STATE_DIR = mkBrowserTestStateDir("surfwright-agent-target-");
const { runCliAsync, runCliSync } = createCliRunner({ stateDir: TEST_TARGET_STATE_DIR });

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

function requireBrowser() {
  const doctor = runCliSync(["--json", "doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
  const ensured = runCliSync(["--json", "session", "ensure", "--timeout-ms", "5000"]);
  assert.equal(ensured.status, 0, ensured.stdout || ensured.stderr);
}

test.after(async () => {
  await cleanupStateDir(TEST_TARGET_STATE_DIR);
});

test("target spawn close and dialog return deterministic shapes", async () => {
  requireBrowser();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Child</title><main>ok</main>");
  });
  const baseUrl = await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected HTTP server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.on("error", reject);
  });
  const childUrl = `${baseUrl}/child`;

  const html = `
    <title>Spawn Close Dialog</title>
    <a id="new-tab" target="_blank" href="${childUrl}">Open Child</a>
    <button id="confirm-btn" onclick="confirm('Delete record?')">Delete</button>
  `;
  const open = runCliSync(["--json", "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const dialog = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "dialog",
      openPayload.targetId,
      "--action",
      "dismiss",
      "--trigger-selector",
      "#confirm-btn",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(dialog.status, 0);
  const dialogPayload = parseJson(dialog.stdout);
  assert.equal(dialogPayload.dialog.action, "dismiss");
  assert.equal(dialogPayload.dialog.type, "confirm");

  const spawn = await runCliAsync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "spawn",
      openPayload.targetId,
      "--selector",
      "#new-tab",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(spawn.status, 0);
  const spawnPayload = parseJson(spawn.stdout);
  assert.equal(spawnPayload.parentTargetId, openPayload.targetId);
  assert.equal(typeof spawnPayload.childTargetId, "string");

  const close = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "close",
      spawnPayload.childTargetId,
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(close.status, 0);
  assert.equal(parseJson(close.stdout).closed, true);

  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

test("target spawn close and dialog return typed failures", () => {
  requireBrowser();

  const open = runCliSync(["--json", "open", "data:text/html,%3Ctitle%3EFlow%3C%2Ftitle%3E", "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const spawnMissing = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "spawn",
      openPayload.targetId,
      "--selector",
      "#missing",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(spawnMissing.status, 1);
  assert.equal(parseJson(spawnMissing.stdout).code, "E_QUERY_INVALID");

  const dialogInvalid = runCliSync(
    ["--json", "--session", openPayload.sessionId, "target", "dialog", openPayload.targetId, "--action", "invalid", "--timeout-ms", "5000"],
  );
  assert.equal(dialogInvalid.status, 1);
  assert.equal(parseJson(dialogInvalid.stdout).code, "E_QUERY_INVALID");

  const closeMissing = runCliSync(
    ["--json", "--session", openPayload.sessionId, "target", "close", "t-missing-target", "--timeout-ms", "5000"],
  );
  assert.equal(closeMissing.status, 1);
  assert.equal(parseJson(closeMissing.stdout).code, "E_TARGET_SESSION_UNKNOWN");
});

test("target emulate and screenshot return deterministic artifacts", () => {
  requireBrowser();

  const open = runCliSync(["--json", "open", "data:text/html,%3Ctitle%3EEmulate%20Shot%3C%2Ftitle%3E%3Cmain%3Eok%3C%2Fmain%3E", "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const emulate = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "emulate",
      openPayload.targetId,
      "--width",
      "390",
      "--height",
      "844",
      "--color-scheme",
      "dark",
      "--touch",
      "--device-scale-factor",
      "2",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(emulate.status, 0);
  const emulatePayload = parseJson(emulate.stdout);
  assert.equal(emulatePayload.emulation.viewport.width, 390);
  assert.equal(emulatePayload.emulation.viewport.height, 844);
  assert.equal(emulatePayload.emulation.colorScheme, "dark");
  assert.equal(emulatePayload.emulation.hasTouch, true);
  assert.equal(emulatePayload.emulation.deviceScaleFactor, 2);

  const emulateNoTouch = runCliSync(
    ["--json", "--session", openPayload.sessionId, "target", "emulate", openPayload.targetId, "--no-touch", "--timeout-ms", "5000"],
  );
  assert.equal(emulateNoTouch.status, 0);
  const emulateNoTouchPayload = parseJson(emulateNoTouch.stdout);
  assert.equal(emulateNoTouchPayload.emulation.hasTouch, false);

  const outPath = path.join(TEST_TARGET_STATE_DIR, "artifacts", "page.png");
  const screenshot = runCliSync(
    ["--json", "--session", openPayload.sessionId, "target", "screenshot", openPayload.targetId, "--out", outPath, "--full-page", "--timeout-ms", "5000"],
  );
  assert.equal(screenshot.status, 0);
  const screenshotPayload = parseJson(screenshot.stdout);
  assert.equal(screenshotPayload.path, outPath);
  assert.equal(screenshotPayload.type, "png");
  assert.equal(screenshotPayload.fullPage, true);
  assert.equal(typeof screenshotPayload.bytes, "number");
  assert.equal(screenshotPayload.bytes > 0, true);
  assert.equal(typeof screenshotPayload.sha256, "string");
  assert.equal(screenshotPayload.sha256.length, 64);
  assert.equal(fs.existsSync(outPath), true);
});

test("target emulate and screenshot return typed validation failures", () => {
  requireBrowser();

  const open = runCliSync(["--json", "open", "data:text/html,%3Ctitle%3EEmulate%20Fail%3C%2Ftitle%3E", "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const emulateInvalid = runCliSync(["--json", "--session", openPayload.sessionId, "target", "emulate", openPayload.targetId, "--width", "10", "--timeout-ms", "5000"]);
  assert.equal(emulateInvalid.status, 1);
  assert.equal(parseJson(emulateInvalid.stdout).code, "E_QUERY_INVALID");

  const screenshotInvalid = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "screenshot",
      openPayload.targetId,
      "--out",
      path.join(TEST_TARGET_STATE_DIR, "artifacts", "bad.png"),
      "--type",
      "png",
      "--quality",
      "80",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(screenshotInvalid.status, 1);
  assert.equal(parseJson(screenshotInvalid.stdout).code, "E_QUERY_INVALID");
});

test("target console-get returns one structured event", () => {
  requireBrowser();

  const sentinel = "CONSOLE_SENTINEL_EXAMPLE_20260214";
  const html = `<title>Console Get</title><script>console.error("${sentinel}")</script>`;
  const open = runCliSync(["--json", "open", `data:text/html,${encodeURIComponent(html)}`, "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const result = runCliSync(
    [
      "--json",
      "--session",
      openPayload.sessionId,
      "target",
      "console-get",
      openPayload.targetId,
      "--contains",
      sentinel,
      "--reload",
      "--capture-ms",
      "800",
      "--timeout-ms",
      "5000",
    ],
  );
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.event, "object");
  assert.equal(payload.event.level, "error");
  assert.equal(payload.event.text.includes(sentinel), true);
  assert.equal(typeof payload.timingMs.total, "number");
});

test("target trace begin export and insight return deterministic shapes", () => {
  requireBrowser();

  const open = runCliSync(["--json", "open", "data:text/html,%3Ctitle%3ETrace%3C%2Ftitle%3E%3Cmain%3Eok%3C%2Fmain%3E", "--timeout-ms", "5000"]);
  assert.equal(open.status, 0);
  const openPayload = parseJson(open.stdout);

  const begin = runCliSync(["--json", "--session", openPayload.sessionId, "target", "trace", "begin", openPayload.targetId, "--max-runtime-ms", "8000", "--timeout-ms", "5000"]);
  assert.equal(begin.status, 0);
  const beginPayload = parseJson(begin.stdout);
  assert.equal(beginPayload.ok, true);
  assert.equal(typeof beginPayload.traceId, "string");
  assert.equal(beginPayload.status, "recording");

  const outPath = path.join(TEST_TARGET_STATE_DIR, "artifacts", "trace.json.gz");
  const exportResult = runCliSync(["--json", "target", "trace", "export", "--trace-id", beginPayload.traceId, "--out", outPath, "--format", "json.gz", "--timeout-ms", "8000"]);
  assert.equal(exportResult.status, 0);
  const exportPayload = parseJson(exportResult.stdout);
  assert.equal(exportPayload.ok, true);
  assert.equal(exportPayload.traceId, beginPayload.traceId);
  assert.equal(exportPayload.out, outPath);
  assert.equal(exportPayload.format, "json");
  assert.equal(exportPayload.gzip, true);
  assert.equal(typeof exportPayload.bytes, "number");
  assert.equal(exportPayload.bytes > 0, true);
  assert.equal(fs.existsSync(outPath), true);
  const traceRaw = zlib.gunzipSync(fs.readFileSync(outPath));
  const tracePayload = JSON.parse(traceRaw.toString("utf8"));
  assert.equal(tracePayload.traceId, beginPayload.traceId);
  assert.equal(tracePayload.targetId, openPayload.targetId);

  const insight = runCliSync(["--json", "--session", openPayload.sessionId, "target", "trace", "insight", openPayload.targetId, "--capture-ms", "200", "--timeout-ms", "5000"]);
  assert.equal(insight.status, 0);
  const insightPayload = parseJson(insight.stdout);
  assert.equal(insightPayload.ok, true);
  assert.equal(typeof insightPayload.insight.name, "string");
  assert.equal(typeof insightPayload.insight.summary, "string");
  assert.equal(typeof insightPayload.insight.severity, "string");
  assert.equal(typeof insightPayload.insight.evidence, "object");
});
