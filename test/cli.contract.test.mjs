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
test("browser-mode rejects invalid values (typed)", () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--browser-mode", "bogus"]);
  assert.equal(ensureResult.status, 1);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.equal(ensurePayload.ok, false);
  assert.equal(ensurePayload.code, "E_QUERY_INVALID");
  assert.equal(ensurePayload.message, "browser-mode must be one of: headless, headed");

  const openResult = runCli(["--json", "open", "https://example.com", "--browser-mode", "bogus"]);
  assert.equal(openResult.status, 1);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, false);
  assert.equal(openPayload.code, "E_QUERY_INVALID");
  assert.equal(openPayload.message, "browser-mode must be one of: headless, headed");
});

test("open without --session creates isolated implicit session", { skip: !hasBrowser() }, () => {
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
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
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

test("open without session creates distinct isolated sessions per invocation", { skip: !hasBrowser() }, () => {
  const firstUrl = `data:text/html,${encodeURIComponent("<title>Isolated One</title><main>one</main>")}`;
  const secondUrl = `data:text/html,${encodeURIComponent("<title>Isolated Two</title><main>two</main>")}`;

  const firstResult = runCli(["--json", "open", firstUrl, "--timeout-ms", "5000"]);
  const secondResult = runCli(["--json", "open", secondUrl, "--timeout-ms", "5000"]);
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

test("open without session skips stale profile directory ids", { skip: !hasBrowser() }, () => {
  const blockedProfileId = "s-1";
  fs.mkdirSync(path.join(TEST_STATE_DIR, "profiles", blockedProfileId), { recursive: true });
  const seededState = {
    version: 3,
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
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.sessionSource, "implicit-new");
  assert.notEqual(openPayload.sessionId, blockedProfileId);
});

test("target command infers session from targetId when --session is omitted", { skip: !hasBrowser() }, () => {
  const html = `<title>Infer Session</title><main><h1>inferred heading</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snapshotResult = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(snapshotResult.status, 0);
  const snapshotPayload = parseJson(snapshotResult.stdout);
  assert.equal(snapshotPayload.ok, true);
  assert.equal(snapshotPayload.sessionId, openPayload.sessionId);
  assert.equal(snapshotPayload.sessionSource, "target-inferred");
  assert.equal(snapshotPayload.title, "Infer Session");
});

test("target session resolution returns typed unknown/mismatch/required errors", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);
  const html = `<title>Session Mismatch</title><main><h1>ok</h1></main>`;
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
  const openPayload = parseJson(openResult.stdout);

  const unknownTargetResult = runCli([
    "--json",
    "target",
    "snapshot",
    "DEADBEEF",
    "--timeout-ms",
    "3000",
  ]);
  assert.equal(unknownTargetResult.status, 1);
  const unknownPayload = parseJson(unknownTargetResult.stdout);
  assert.equal(unknownPayload.code, "E_TARGET_SESSION_UNKNOWN");

  const otherSessionId = `s-mismatch-${Date.now()}`;
  const newSessionResult = runCli([
    "--json",
    "session",
    "new",
    "--session-id",
    otherSessionId,
    "--timeout-ms",
    "6000",
  ]);
  assert.equal(newSessionResult.status, 0);

  const mismatchResult = runCli([
    "--json",
    "--session",
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

  const noSessionListResult = runCli(["--json", "target", "list", "--timeout-ms", "3000"]);
  assert.equal(noSessionListResult.status, 1);
  const requiredPayload = parseJson(noSessionListResult.stdout);
  assert.equal(requiredPayload.code, "E_SESSION_REQUIRED");
});

test("target wait emits typed timeout error", { skip: !hasBrowser() }, () => {
  const html = `<title>Wait Timeout</title><main><h1>ready</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const waitResult = runCli([
    "--json",
    "target",
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

test("target eval validates script size before session resolution", () => {
  const oversizedExpression = "x".repeat(5000);
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--expression",
    oversizedExpression,
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_EVAL_SCRIPT_TOO_LARGE");
});

test("target eval accepts --js alias", () => {
  const evalResult = runCli([
    "--json",
    "target",
    "eval",
    "ABCDEF123456",
    "--js",
    "1 + 1",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("target eval returns deterministic shape and typed runtime failures", { skip: !hasBrowser() }, () => {
  const html = `<title>Eval Contract</title><main><h1>Eval</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const evalSuccessResult = runCli([
    "--json",
    "target",
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

  const evalFailureResult = runCli([
    "--json",
    "target",
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

test("session fresh creates ephemeral managed session", { skip: !hasBrowser() }, () => {
  const sessionId = `s-fresh-${Date.now()}`;
  const freshResult = runCli(["--json", "session", "fresh", "--session-id", sessionId, "--timeout-ms", "6000"]);
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

test("open supports shared isolation mode", { skip: !hasBrowser() }, () => {
  const firstUrl = `data:text/html,${encodeURIComponent("<title>Shared One</title><main>one</main>")}`;
  const secondUrl = `data:text/html,${encodeURIComponent("<title>Shared Two</title><main>two</main>")}`;
  const firstResult = runCli(["--json", "open", firstUrl, "--isolation", "shared", "--timeout-ms", "5000"]);
  const secondResult = runCli(["--json", "open", secondUrl, "--isolation", "shared", "--timeout-ms", "5000"]);
  assert.equal(firstResult.status, 0);
  assert.equal(secondResult.status, 0);
  const firstPayload = parseJson(firstResult.stdout);
  const secondPayload = parseJson(secondResult.stdout);
  assert.equal(firstPayload.sessionSource, "explicit");
  assert.equal(secondPayload.sessionSource, "explicit");
  assert.equal(firstPayload.sessionId, secondPayload.sessionId);
});

test("session new and session use switch active pointer", { skip: !hasBrowser() }, () => {
  const sessionId = `s-contract-${Date.now()}`;
  const createResult = runCli(["--json", "session", "new", "--session-id", sessionId, "--timeout-ms", "6000"]);
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
