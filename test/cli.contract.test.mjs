import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-contract-"));
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
function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env: {
        ...process.env,
        SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
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
test("open invalid URL returns typed compact JSON failure", () => {
  const result = runCli(["--json", "open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.trim().startsWith('{"ok":false,'));
  const payload = parseJson(result.stdout);
  assert.deepEqual(Object.keys(payload), ["ok", "code", "message"]);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_URL_INVALID");
  assert.equal(typeof payload.message, "string");
});
test("--pretty switches to multiline JSON", () => {
  const result = runCli(["--json", "--pretty", "open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("\n  \"ok\": false"));
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});
test("session attach requires explicit valid CDP origin", () => {
  const result = runCli(["--json", "session", "attach", "--cdp", "not-a-url"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_CDP_INVALID");
});
test("contract command returns machine-readable command and error metadata", () => {
  const result = runCli(["--json", "contract"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "surfwright");
  assert.equal(typeof payload.version, "string");
  assert.equal(Array.isArray(payload.commands), true);
  assert.equal(Array.isArray(payload.errors), true);
  assert.equal(payload.commands.some((entry) => entry.id === "open"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.list"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.snapshot"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.find"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.read"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.wait"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network-export"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network-begin"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network-end"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network-export-list"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network-export" && entry.usage.includes("--out <path>")), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.network" && entry.usage.includes("--profile <preset>")), true);
  assert.equal(payload.commands.some((entry) => entry.id === "contract"), true);
  assert.equal(payload.errors.some((entry) => entry.code === "E_URL_INVALID"), true);
  assert.equal(payload.errors.some((entry) => entry.code === "E_TARGET_NOT_FOUND"), true);
  assert.equal(payload.errors.some((entry) => entry.code === "E_QUERY_INVALID"), true);
  assert.equal(payload.errors.some((entry) => entry.code === "E_SELECTOR_INVALID"), true);
  assert.equal(payload.errors.some((entry) => entry.code === "E_STATE_LOCK_TIMEOUT"), true);
});
test("session ensure + open success returns contract shape", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.deepEqual(Object.keys(ensurePayload), ["ok", "sessionId", "kind", "cdpOrigin", "active", "created", "restarted"]);
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.kind, "managed");
  assert.equal(ensurePayload.active, true);
  const longText = "chunk ".repeat(320);
  const html = `<title>Contract Test Page</title><main><h1>ok heading</h1><p>${longText}</p><p style=\"display:none\">secret hidden</p></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    dataUrl,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(openResult.status, 0);
  assert.ok(openResult.stdout.trim().startsWith('{"ok":true,'));
  const openPayload = parseJson(openResult.stdout);
  assert.deepEqual(Object.keys(openPayload), ["ok", "sessionId", "targetId", "url", "status", "title"]);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionId, ensurePayload.sessionId);
  assert.equal(typeof openPayload.targetId, "string");
  assert.equal(openPayload.targetId.length > 0, true);
  assert.equal(openPayload.url, dataUrl);
  assert.equal(openPayload.status, null);
  assert.equal(openPayload.title, "Contract Test Page");
  const reopenReuseResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    dataUrl,
    "--reuse-url",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(reopenReuseResult.status, 0);
  const reopenReusePayload = parseJson(reopenReuseResult.stdout);
  assert.equal(reopenReusePayload.ok, true);
  assert.equal(reopenReusePayload.targetId, openPayload.targetId);
  assert.equal(reopenReusePayload.status, null);
  const listResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "list",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.deepEqual(Object.keys(listPayload), ["ok", "sessionId", "targets"]);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.sessionId, ensurePayload.sessionId);
  assert.equal(Array.isArray(listPayload.targets), true);
  assert.equal(listPayload.targets.some((entry) => entry.targetId === openPayload.targetId), true);
  const snapshotResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "snapshot",
    openPayload.targetId,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(snapshotResult.status, 0);
  const snapshotPayload = parseJson(snapshotResult.stdout);
  assert.deepEqual(Object.keys(snapshotPayload), [
    "ok",
    "sessionId",
    "targetId",
    "url",
    "title",
    "scope",
    "textPreview",
    "headings",
    "buttons",
    "links",
    "truncated",
  ]);
  assert.equal(snapshotPayload.ok, true);
  assert.equal(snapshotPayload.sessionId, ensurePayload.sessionId);
  assert.equal(snapshotPayload.targetId, openPayload.targetId);
  assert.equal(snapshotPayload.url, dataUrl);
  assert.equal(snapshotPayload.title, "Contract Test Page");
  assert.equal(typeof snapshotPayload.scope, "object");
  assert.equal(snapshotPayload.scope.selector, null);
  assert.equal(typeof snapshotPayload.textPreview, "string");
  assert.equal(Array.isArray(snapshotPayload.headings), true);
  assert.equal(Array.isArray(snapshotPayload.buttons), true);
  assert.equal(Array.isArray(snapshotPayload.links), true);
  assert.equal(typeof snapshotPayload.truncated, "object");
  const findByTextResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "find",
    openPayload.targetId,
    "--text",
    "ok",
    "--limit",
    "5",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(findByTextResult.status, 0);
  const findByTextPayload = parseJson(findByTextResult.stdout);
  assert.deepEqual(Object.keys(findByTextPayload), [
    "ok",
    "sessionId",
    "targetId",
    "mode",
    "selector",
    "contains",
    "visibleOnly",
    "first",
    "query",
    "count",
    "limit",
    "matches",
    "truncated",
  ]);
  assert.equal(findByTextPayload.ok, true);
  assert.equal(findByTextPayload.sessionId, ensurePayload.sessionId);
  assert.equal(findByTextPayload.targetId, openPayload.targetId);
  assert.equal(findByTextPayload.mode, "text");
  assert.equal(findByTextPayload.selector, null);
  assert.equal(findByTextPayload.contains, null);
  assert.equal(findByTextPayload.visibleOnly, false);
  assert.equal(findByTextPayload.first, false);
  assert.equal(findByTextPayload.query, "ok");
  assert.equal(typeof findByTextPayload.count, "number");
  assert.equal(findByTextPayload.limit, 5);
  assert.equal(Array.isArray(findByTextPayload.matches), true);
  assert.equal(typeof findByTextPayload.truncated, "boolean");
  const findBySelectorResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "find",
    openPayload.targetId,
    "--selector",
    "h1",
    "--limit",
    "5",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(findBySelectorResult.status, 0);
  const findBySelectorPayload = parseJson(findBySelectorResult.stdout);
  assert.equal(findBySelectorPayload.ok, true);
  assert.equal(findBySelectorPayload.mode, "selector");
  assert.equal(findBySelectorPayload.query, "h1");
  const findBySelectorContainsResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "find",
    openPayload.targetId,
    "--selector",
    "h1",
    "--contains",
    "ok",
    "--first",
    "--visible-only",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(findBySelectorContainsResult.status, 0);
  const findBySelectorContainsPayload = parseJson(findBySelectorContainsResult.stdout);
  assert.equal(findBySelectorContainsPayload.ok, true);
  assert.equal(findBySelectorContainsPayload.mode, "selector");
  assert.equal(findBySelectorContainsPayload.selector, "h1");
  assert.equal(findBySelectorContainsPayload.contains, "ok");
  assert.equal(findBySelectorContainsPayload.first, true);
  assert.equal(findBySelectorContainsPayload.visibleOnly, true);
  assert.equal(findBySelectorContainsPayload.limit, 1);
  const findMissingQueryResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "find",
    openPayload.targetId,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(findMissingQueryResult.status, 1);
  const findMissingQueryPayload = parseJson(findMissingQueryResult.stdout);
  assert.equal(findMissingQueryPayload.ok, false);
  assert.equal(findMissingQueryPayload.code, "E_QUERY_INVALID");
  const readResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "read",
    openPayload.targetId,
    "--selector",
    "main",
    "--visible-only",
    "--chunk-size",
    "80",
    "--chunk",
    "1",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(readResult.status, 0);
  const readPayload = parseJson(readResult.stdout);
  assert.deepEqual(Object.keys(readPayload), [
    "ok",
    "sessionId",
    "targetId",
    "url",
    "title",
    "scope",
    "chunkSize",
    "chunkIndex",
    "totalChunks",
    "totalChars",
    "text",
    "truncated",
  ]);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.scope.selector, "main");
  assert.equal(readPayload.scope.visibleOnly, true);
  assert.equal(readPayload.chunkSize, 80);
  assert.equal(readPayload.chunkIndex, 1);
  assert.equal(typeof readPayload.totalChars, "number");
  assert.equal(typeof readPayload.text, "string");
  const waitSelectorResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "wait",
    openPayload.targetId,
    "--for-selector",
    "h1",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(waitSelectorResult.status, 0);
  const waitSelectorPayload = parseJson(waitSelectorResult.stdout);
  assert.deepEqual(Object.keys(waitSelectorPayload), ["ok", "sessionId", "targetId", "url", "title", "mode", "value"]);
  assert.equal(waitSelectorPayload.ok, true);
  assert.equal(waitSelectorPayload.mode, "selector");
  assert.equal(waitSelectorPayload.value, "h1");
  const waitNetworkIdleResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "wait",
    openPayload.targetId,
    "--network-idle",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(waitNetworkIdleResult.status, 0);
  const waitNetworkIdlePayload = parseJson(waitNetworkIdleResult.stdout);
  assert.equal(waitNetworkIdlePayload.ok, true);
  assert.equal(waitNetworkIdlePayload.mode, "network-idle");
  assert.equal(waitNetworkIdlePayload.value, null);
});
test("session new and session use switch active pointer", { skip: !hasBrowser() }, () => {
  const sessionId = `s-contract-${Date.now()}`;
  const createResult = runCli([
    "--json",
    "session",
    "new",
    "--session-id",
    sessionId,
    "--timeout-ms",
    "6000",
  ]);
  assert.equal(createResult.status, 0);
  const createPayload = parseJson(createResult.stdout);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.sessionId, sessionId);
  assert.equal(createPayload.kind, "managed");
  assert.equal(createPayload.active, true);
  assert.equal(createPayload.created, true);
  const useResult = runCli(["--json", "session", "use", sessionId, "--timeout-ms", "6000"]);
  assert.equal(useResult.status, 0);
  const usePayload = parseJson(useResult.stdout);
  assert.equal(usePayload.ok, true);
  assert.equal(usePayload.sessionId, sessionId);
  assert.equal(usePayload.active, true);
  const listResult = runCli(["--json", "session", "list"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.activeSessionId, sessionId);
  assert.equal(Array.isArray(listPayload.sessions), true);
  assert.equal(listPayload.sessions.some((entry) => entry.sessionId === sessionId), true);
});
test("concurrent session new with same id returns one typed conflict", { skip: !hasBrowser() }, async () => {
  const sessionId = `s-concurrent-${Date.now()}`;
  const args = ["--json", "session", "new", "--session-id", sessionId, "--timeout-ms", "6000"];
  const [first, second] = await Promise.all([runCliAsync(args), runCliAsync(args)]);
  const results = [first, second];
  const successes = results.filter((result) => result.status === 0);
  const failures = results.filter((result) => result.status === 1);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  const failurePayload = parseJson(failures[0].stdout);
  assert.equal(failurePayload.ok, false);
  assert.equal(failurePayload.code, "E_SESSION_EXISTS");
});
