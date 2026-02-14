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
test("session ensure + open success returns contract shape", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.deepEqual(Object.keys(ensurePayload), [
    "ok",
    "sessionId",
    "kind",
    "cdpOrigin",
    "browserMode",
    "active",
    "created",
    "restarted",
  ]);
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.kind, "managed");
  assert.equal(ensurePayload.browserMode, "headless");
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
  assert.deepEqual(Object.keys(openPayload), [
    "ok","sessionId","sessionSource","browserMode","targetId","actionId",
    "requestedUrl","finalUrl","wasRedirected","redirectChain","redirectChainTruncated",
    "url","status","title","timingMs",
  ]);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionId, ensurePayload.sessionId);
  assert.equal(openPayload.sessionSource, "explicit");
  assert.equal(openPayload.browserMode, ensurePayload.browserMode);
  assert.equal(typeof openPayload.targetId, "string");
  assert.equal(openPayload.targetId.length > 0, true);
  assert.equal(typeof openPayload.actionId, "string");
  assert.equal(openPayload.actionId.length > 0, true);
  assert.equal(openPayload.url, dataUrl);
  assert.equal(openPayload.requestedUrl, dataUrl);
  assert.equal(openPayload.finalUrl, dataUrl);
  assert.equal(openPayload.wasRedirected, false);
  assert.equal(openPayload.redirectChain, null);
  assert.equal(openPayload.redirectChainTruncated, false);
  assert.equal(openPayload.status, null);
  assert.equal(openPayload.title, "Contract Test Page");
  assert.equal(typeof openPayload.timingMs, "object");
  assert.equal(typeof openPayload.timingMs.total, "number");
  const openProjectedResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "open",
    dataUrl,
    "--reuse-url",
    "--fields",
    "sessionId,targetId,url",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(openProjectedResult.status, 0);
  const openProjectedPayload = parseJson(openProjectedResult.stdout);
  assert.deepEqual(Object.keys(openProjectedPayload), ["ok", "sessionId", "targetId", "url"]);
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
  assert.deepEqual(Object.keys(listPayload), ["ok", "sessionId", "sessionSource", "targets", "timingMs"]);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.sessionId, ensurePayload.sessionId);
  assert.equal(listPayload.sessionSource, "explicit");
  assert.equal(Array.isArray(listPayload.targets), true);
  assert.equal(listPayload.targets.some((entry) => entry.targetId === openPayload.targetId), true);
  assert.equal(typeof listPayload.timingMs, "object");
  assert.equal(typeof listPayload.timingMs.total, "number");
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
    "sessionSource",
    "targetId",
    "url",
    "title",
    "scope",
    "textPreview",
    "headings",
    "buttons",
    "links",
    "truncated",
    "hints",
    "timingMs",
  ]);
  assert.equal(snapshotPayload.ok, true);
  assert.equal(snapshotPayload.sessionId, ensurePayload.sessionId);
  assert.equal(snapshotPayload.sessionSource, "explicit");
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
  assert.equal(typeof snapshotPayload.timingMs, "object");
  assert.equal(typeof snapshotPayload.timingMs.total, "number");
  const snapshotProjectedResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "snapshot",
    openPayload.targetId,
    "--no-persist",
    "--fields",
    "targetId,url,title",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(snapshotProjectedResult.status, 0);
  const snapshotProjectedPayload = parseJson(snapshotProjectedResult.stdout);
  assert.deepEqual(Object.keys(snapshotProjectedPayload), ["ok", "targetId", "url", "title"]);
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
    "sessionSource",
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
    "timingMs",
  ]);
  assert.equal(findByTextPayload.ok, true);
  assert.equal(findByTextPayload.sessionId, ensurePayload.sessionId);
  assert.equal(findByTextPayload.sessionSource, "explicit");
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
  assert.equal(typeof findByTextPayload.timingMs, "object");
  assert.equal(typeof findByTextPayload.timingMs.total, "number");
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
    "sessionSource",
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
    "hints",
    "timingMs",
  ]);
  assert.equal(readPayload.ok, true);
  assert.equal(readPayload.scope.selector, "main");
  assert.equal(readPayload.scope.visibleOnly, true);
  assert.equal(readPayload.chunkSize, 80);
  assert.equal(readPayload.chunkIndex, 1);
  assert.equal(typeof readPayload.totalChars, "number");
  assert.equal(typeof readPayload.text, "string");
  assert.equal(typeof readPayload.timingMs, "object");
  assert.equal(typeof readPayload.timingMs.total, "number");
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
  assert.deepEqual(Object.keys(waitSelectorPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "url",
    "title",
    "mode",
    "value",
    "timingMs",
  ]);
  assert.equal(waitSelectorPayload.ok, true);
  assert.equal(waitSelectorPayload.mode, "selector");
  assert.equal(waitSelectorPayload.value, "h1");
  assert.equal(typeof waitSelectorPayload.timingMs, "object");
  assert.equal(typeof waitSelectorPayload.timingMs.total, "number");
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

function loadFixture(relativePath) {
  const fixturePath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

test("contract command matches fixture-backed command surface", () => {
  const result = runCli(["--json", "contract"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.name, "surfwright");
  assert.equal(typeof payload.version, "string");
  assert.equal(Array.isArray(payload.commands), true);
  assert.equal(Array.isArray(payload.errors), true);

  const expectedCore = loadFixture("test/fixtures/contract/commands.core.json");
  const expectedNetwork = loadFixture("test/fixtures/contract/commands.network.json");
  const expectedExperimental = loadFixture("test/fixtures/contract/commands.experimental.json");
  const expectedErrors = loadFixture("test/fixtures/contract/errors.json");
  const commandById = new Map(payload.commands.map((entry) => [entry.id, entry]));

  for (const entry of [...expectedCore, ...expectedNetwork, ...expectedExperimental]) {
    const actual = commandById.get(entry.id);
    assert.notEqual(actual, undefined, `missing command ${entry.id}`);
    assert.equal(actual.usage.includes(entry.usageMustContain), true, `usage mismatch for ${entry.id}`);
  }

  const seenErrors = new Set(payload.errors.map((entry) => entry.code));
  for (const code of expectedErrors) {
    assert.equal(seenErrors.has(code), true, `missing error code ${code}`);
  }
});
