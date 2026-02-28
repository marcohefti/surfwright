import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-cli-browser-contract-");
const { runCliSync, runCliAsync } = createCliRunner({ stateDir: TEST_STATE_DIR });

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return runCliSync(args);
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
  const result = runCli(["doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("open without --session creates isolated implicit session", () => {
  requireBrowser();

  const existingState = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
  const staleState = {
    ...existingState,
    activeSessionId: "a-stale",
    sessions: {
      ...existingState.sessions,
      "a-stale": {
        sessionId: "a-stale",
        kind: "attached",
        policy: "persistent",
        cdpOrigin: "http://127.0.0.1:9",
        debugPort: 9,
        userDataDir: null,
        browserPid: null,
        ownerId: null,
        leaseExpiresAt: null,
        leaseTtlMs: null,
        managedUnreachableSince: null,
        managedUnreachableCount: 0,
        createdAt: "2026-02-13T10:00:00.000Z",
        lastSeenAt: "2026-02-13T10:00:00.000Z",
      },
    },
  };
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(staleState, null, 2)}\n`, "utf8");

  const dataUrl = `data:text/html,${encodeURIComponent("<title>Recovered Open</title><main>ok</main>")}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, true);
  assert.equal(typeof openPayload.sessionId, "string");
  assert.notEqual(openPayload.sessionId, "a-stale");
  assert.equal(openPayload.sessionSource, "implicit-new");
  assert.equal(openPayload.title, "Recovered Open");

  const state = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
  assert.equal(state.activeSessionId, openPayload.sessionId);
});

test("open without session creates distinct isolated sessions per invocation", () => {
  requireBrowser();

  const firstUrl = `data:text/html,${encodeURIComponent("<title>Isolated One</title><main>one</main>")}`;
  const secondUrl = `data:text/html,${encodeURIComponent("<title>Isolated Two</title><main>two</main>")}`;

  const firstResult = runCli(["open", firstUrl, "--timeout-ms", "5000"]);
  const secondResult = runCli(["open", secondUrl, "--timeout-ms", "5000"]);
  assert.equal(firstResult.status, 0);
  assert.equal(secondResult.status, 0);

  const firstPayload = parseJson(firstResult.stdout);
  const secondPayload = parseJson(secondResult.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(secondPayload.ok, true);
  assert.equal(firstPayload.sessionSource, "implicit-new");
  assert.equal(secondPayload.sessionSource, "implicit-new");
  assert.notEqual(firstPayload.sessionId, secondPayload.sessionId);
});

test("open without session skips stale profile directory ids", () => {
  requireBrowser();

  const blockedProfileId = "s-1";
  fs.mkdirSync(path.join(TEST_STATE_DIR, "profiles", blockedProfileId), { recursive: true });
  const seededState = {
    version: 4,
    activeSessionId: null,
    nextSessionOrdinal: 1,
    nextCaptureOrdinal: 1,
    nextArtifactOrdinal: 1,
    sessions: {},
    targets: {},
    networkCaptures: {},
    networkArtifacts: {},
  };
  fs.writeFileSync(stateFilePath(), `${JSON.stringify(seededState, null, 2)}\n`, "utf8");

  const html = `<title>Skip Stale Profile</title><main>ok</main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionSource, "implicit-new");
  assert.notEqual(openPayload.sessionId, blockedProfileId);
});

test("target command infers session from targetId when --session is omitted", () => {
  requireBrowser();

  const html = `<title>Infer Session</title><main><h1>inferred heading</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snapshotResult = runCli(["target", "snapshot", openPayload.targetId, "--timeout-ms", "5000"]);
  assert.equal(snapshotResult.status, 0);
  const snapshotPayload = parseJson(snapshotResult.stdout);
  assert.equal(snapshotPayload.ok, true);
  assert.equal(snapshotPayload.sessionId, openPayload.sessionId);
  assert.equal(snapshotPayload.sessionSource, "target-inferred");
  assert.equal(snapshotPayload.title, "Infer Session");
});

test("target session resolution returns typed unknown/mismatch/required errors", () => {
  requireBrowser();

  const ensureResult = runCli(["session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);
  const html = `<title>Session Mismatch</title><main><h1>ok</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const unknownTargetResult = runCli(["target", "snapshot", "DEADBEEF", "--timeout-ms", "3000"]);
  assert.equal(unknownTargetResult.status, 1);
  const unknownPayload = parseJson(unknownTargetResult.stdout);
  assert.equal(["E_TARGET_SESSION_UNKNOWN", "E_TARGET_NOT_FOUND"].includes(unknownPayload.code), true);

  const otherSessionId = `s-mismatch-${Date.now()}`;
  const newSessionResult = runCli(["session", "new", "--session-id", otherSessionId, "--timeout-ms", "6000"]);
  assert.equal(newSessionResult.status, 0);

  const mismatchResult = runCli(["--session",
    otherSessionId,
    "target",
    "snapshot",
    openPayload.targetId,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(mismatchResult.status, 1);
  const mismatchPayload = parseJson(mismatchResult.stdout);
  assert.equal(mismatchPayload.code, "E_TARGET_SESSION_MISMATCH");

  const noSessionListResult = runCli(["target", "list", "--timeout-ms", "3000"]);
  assert.equal(noSessionListResult.status, 1);
  const requiredPayload = parseJson(noSessionListResult.stdout);
  assert.equal(requiredPayload.code, "E_SESSION_REQUIRED");
});

test("target wait emits typed timeout error", () => {
  requireBrowser();

  const html = `<title>Wait Timeout</title><main><h1>ready</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const waitResult = runCli(["target",
    "wait",
    openPayload.targetId,
    "--for-selector",
    ".never-here",
    "--timeout-ms",
    "500",
  ]);
  assert.equal(waitResult.status, 1);
  const waitPayload = parseJson(waitResult.stdout);
  assert.equal(waitPayload.code, "E_WAIT_TIMEOUT");
});

test("target eval returns deterministic shape and typed runtime failures", () => {
  requireBrowser();

  const html = `<title>Eval Contract</title><main><h1>Eval</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const evalSuccessResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expression",
    "console.log('hello from agent'); return { ok: true, value: 42, text: 'abc' };",
    "--capture-console",
    "--max-console",
    "5",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(evalSuccessResult.status, 0);
  const evalSuccessPayload = parseJson(evalSuccessResult.stdout);
  assert.deepEqual(Object.keys(evalSuccessPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "actionId",
    "expression",
    "context",
    "result",
    "console",
    "timingMs",
  ]);
  assert.equal(evalSuccessPayload.ok, true);
  assert.equal(evalSuccessPayload.sessionId, openPayload.sessionId);
  assert.equal(evalSuccessPayload.sessionSource, "target-inferred");
  assert.equal(evalSuccessPayload.targetId, openPayload.targetId);
  assert.equal(typeof evalSuccessPayload.actionId, "string");
  assert.equal(evalSuccessPayload.expression.includes("console.log"), true);
  assert.equal(evalSuccessPayload.result.type, "object");
  assert.equal(evalSuccessPayload.result.value.value, 42);
  assert.equal(typeof evalSuccessPayload.result.truncated, "boolean");
  assert.equal(evalSuccessPayload.console.captured, true);
  assert.equal(evalSuccessPayload.console.count >= 1, true);
  assert.equal(Array.isArray(evalSuccessPayload.console.entries), true);
  assert.equal(evalSuccessPayload.console.entries[0]?.text.includes("hello from agent"), true);
  assert.equal(typeof evalSuccessPayload.timingMs.total, "number");

  const evalProofResult = runCli(["--output-shape",
    "proof",
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return { ok: true, value: 42 };",
    "--capture-console",
    "--max-console",
    "5",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(evalProofResult.status, 0);
  const evalProofPayload = parseJson(evalProofResult.stdout);
  assert.equal(evalProofPayload.ok, true);
  assert.equal(typeof evalProofPayload.proof, "object");
  assert.equal(evalProofPayload.proof.resultType, "object");
  assert.equal(evalProofPayload.proof.resultValue.value, 42);

  const evalFailureResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expression",
    "throw new Error('boom from eval')",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(evalFailureResult.status, 1);
  const evalFailurePayload = parseJson(evalFailureResult.stdout);
  assert.equal(evalFailurePayload.ok, false);
  assert.equal(evalFailurePayload.code, "E_EVAL_RUNTIME");
});

test("session fresh creates ephemeral managed session", () => {
  requireBrowser();

  const sessionId = `s-fresh-${Date.now()}`;
  const freshResult = runCli(["session", "fresh", "--session-id", sessionId, "--timeout-ms", "6000"]);
  assert.equal(freshResult.status, 0);
  const freshPayload = parseJson(freshResult.stdout);
  assert.equal(freshPayload.ok, true);
  assert.equal(freshPayload.sessionId, sessionId);
  assert.equal(freshPayload.kind, "managed");
  assert.equal(freshPayload.active, true);

  const state = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
  assert.equal(state.activeSessionId, sessionId);
  assert.equal(state.sessions?.[sessionId]?.policy, "ephemeral");
});

test("open supports shared isolation mode", () => {
  requireBrowser();

  const firstUrl = `data:text/html,${encodeURIComponent("<title>Shared One</title><main>one</main>")}`;
  const secondUrl = `data:text/html,${encodeURIComponent("<title>Shared Two</title><main>two</main>")}`;
  const firstResult = runCli(["open", firstUrl, "--isolation", "shared", "--timeout-ms", "5000"]);
  const secondResult = runCli(["open", secondUrl, "--isolation", "shared", "--timeout-ms", "5000"]);
  assert.equal(firstResult.status, 0);
  assert.equal(secondResult.status, 0);
  const firstPayload = parseJson(firstResult.stdout);
  const secondPayload = parseJson(secondResult.stdout);
  assert.equal(firstPayload.sessionSource, "explicit");
  assert.equal(secondPayload.sessionSource, "explicit");
  assert.equal(firstPayload.sessionId, secondPayload.sessionId);
});

test("session new and session use switch active pointer", () => {
  requireBrowser();

  const sessionId = `s-contract-${Date.now()}`;
  const createResult = runCli(["session", "new", "--session-id", sessionId, "--timeout-ms", "6000"]);
  assert.equal(createResult.status, 0);
  const createPayload = parseJson(createResult.stdout);
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.sessionId, sessionId);
  assert.equal(createPayload.kind, "managed");
  assert.equal(createPayload.active, true);
  assert.equal(createPayload.created, true);
  const useResult = runCli(["session", "use", sessionId, "--timeout-ms", "6000"]);
  assert.equal(useResult.status, 0);
  const usePayload = parseJson(useResult.stdout);
  assert.equal(usePayload.ok, true);
  assert.equal(usePayload.sessionId, sessionId);
  assert.equal(usePayload.active, true);
  const listResult = runCli(["session", "list"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.activeSessionId, sessionId);
  assert.equal(Array.isArray(listPayload.sessions), true);
  assert.equal(listPayload.sessions.some((entry) => entry.sessionId === sessionId), true);
});

test("concurrent session new with same id returns one typed conflict", async () => {
  requireBrowser();

  const sessionId = `s-concurrent-${Date.now()}`;
  const args = ["session", "new", "--session-id", sessionId, "--timeout-ms", "6000"];
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
