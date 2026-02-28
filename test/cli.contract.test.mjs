import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearStateStorageArtifacts, stateFilePath, writeCanonicalState } from "./core/state-storage.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-cli-contract-"));

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

function baseState() {
  return {
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
}

function writeState(state) {
  writeCanonicalState(TEST_STATE_DIR, state);
}

function writeSnapshotState(state) {
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(TEST_STATE_DIR), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function clearStateArtifacts() {
  clearStateStorageArtifacts(TEST_STATE_DIR);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("open invalid URL returns typed compact JSON failure", () => {
  const result = runCli(["open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.trim().startsWith('{"ok":false,'));
  const payload = parseJson(result.stdout);
  assert.deepEqual(Object.keys(payload), ["ok", "code", "message"]);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_URL_INVALID");
  assert.equal(typeof payload.message, "string");
});

test("json-mode parse failures stay pure JSON without commander help text", () => {
  const result = runCli(["open", "https://example.com", "--no-persist"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(result.stdout.includes("Usage:"), false);
  assert.equal(result.stderr.trim(), "");
});

test("--pretty switches to multiline JSON", () => {
  const result = runCli(["--pretty", "open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes("\n  \"ok\": false"));
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test("session attach requires explicit valid CDP origin", () => {
  const result = runCli(["session", "attach", "--cdp", "not-a-url"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_CDP_INVALID");
});

test("timeout parsers return E_QUERY_INVALID instead of E_INTERNAL", () => {
  const result = runCli(["session", "ensure", "--timeout-ms", "abc"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(payload.message, "timeout-ms must be a positive integer");
});

test("invalid state JSON is quarantined and returns typed failure", () => {
  clearStateArtifacts();
  fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(TEST_STATE_DIR), "{broken-json", "utf8");

  const result = runCli(["session", "list"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_STATE_READ_INVALID");
  assert.equal(typeof payload.hintContext?.quarantinedPath, "string");
  assert.equal(fs.existsSync(payload.hintContext.quarantinedPath), true);
});

test("state version mismatch is quarantined and returns typed failure", () => {
  clearStateArtifacts();
  const stale = baseState();
  stale.version = 999;
  writeSnapshotState(stale);

  const result = runCli(["session", "list"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_STATE_VERSION_MISMATCH");
  assert.equal(typeof payload.hintContext?.quarantinedPath, "string");
  assert.equal(fs.existsSync(payload.hintContext.quarantinedPath), true);
});

test("session attach accepts ws:// CDP endpoint format (returns typed unreachable if offline)", () => {
  const result = runCli(["session",
    "attach",
    "--cdp",
    "ws://127.0.0.1:9/devtools/browser/fake",
    "--timeout-ms",
    "300",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_CDP_UNREACHABLE");
});

test("browser-mode rejects invalid values (typed)", () => {
  const ensureResult = runCli(["session", "ensure", "--browser-mode", "bogus"]);
  assert.equal(ensureResult.status, 1);
  const ensurePayload = parseJson(ensureResult.stdout);
  assert.equal(ensurePayload.ok, false);
  assert.equal(ensurePayload.code, "E_QUERY_INVALID");
  assert.equal(ensurePayload.message, "browser-mode must be one of: headless, headed");

  const openResult = runCli(["open", "https://example.com", "--browser-mode", "bogus"]);
  assert.equal(openResult.status, 1);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, false);
  assert.equal(openPayload.code, "E_QUERY_INVALID");
  assert.equal(openPayload.message, "browser-mode must be one of: headless, headed");
});

test("target eval validates script size before session resolution", () => {
  const oversizedExpression = "x".repeat(5000);
  const evalResult = runCli(["target",
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

test("target eval rejects removed --js alias", () => {
  const evalResult = runCli(["target",
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
  assert.equal(evalPayload.code, "E_QUERY_INVALID");
});

test("target subcommands use canonical positional targetId", () => {
  const evalResult = runCli(["target",
    "eval",
    "DEADBEEF",
    "--expression",
    "1 + 1",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(evalResult.status, 1);
  const payload = parseJson(evalResult.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("open validates ensure-session mode early", () => {
  const openResult = runCli(["open", "https://example.com", "--ensure-session", "not-a-mode", "--timeout-ms", "1000"]);
  assert.equal(openResult.status, 1);
  const payload = parseJson(openResult.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(payload.message, "ensure-session must be one of: off, if-missing, fresh");
});

test("target find validates href-path-prefix before session resolution", () => {
  const findResult = runCli(["target",
    "find",
    "ABCDEF123456",
    "--text",
    "Repo",
    "--href-path-prefix",
    "marcohefti/",
    "--timeout-ms",
    "1000",
  ]);
  assert.equal(findResult.status, 1);
  const findPayload = parseJson(findResult.stdout);
  assert.equal(findPayload.ok, false);
  assert.equal(findPayload.code, "E_QUERY_INVALID");
  assert.equal(findPayload.message, "href-path-prefix must start with '/'");
});

test("contract unknown option includes focused alternatives for compact/search", () => {
  const result = runCli(["contract", "--kind", "json"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(payload.hints.some((hint) => hint.includes("Use --search <term>")), true);
  assert.equal(payload.hints.some((hint) => hint.includes("add --full")), true);
  assert.equal(Array.isArray(payload.diagnostics?.unknownFlags), true);
  assert.equal(payload.diagnostics?.unknownFlags?.includes("--kind"), true);
  assert.equal(Array.isArray(payload.diagnostics?.validFlags), true);
  assert.equal(payload.diagnostics?.validFlags?.includes("--search"), true);
  assert.equal(typeof payload.diagnostics?.canonicalInvocation, "string");
  assert.equal(payload.diagnostics?.canonicalInvocation?.includes("surfwright contract"), true);
  assert.equal(payload.hintContext?.commandPath, "contract");
  assert.equal(payload.hintContext?.unknownOption, "--kind");
});

test("session clear parse failures include scoped cleanup hint for extra positional input", () => {
  const result = runCli(["session", "clear", "s-demo"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(payload.hints.some((hint) => hint.includes("--session <id>")), true);
  assert.equal(payload.hintContext?.commandPath, "session clear");
});

test("contract --core returns focused bootstrap payload", () => {
  const result = runCli(["contract", "--core"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "core");
  assert.equal(Array.isArray(payload.commands), true);
  assert.equal(Array.isArray(payload.errors), true);
  assert.equal(Array.isArray(payload.guidance), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.click"), true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.count"), true);
});

test("contract --command returns compact per-command schema", () => {
  const result = runCli(["contract", "--command", "target.download"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "command");
  assert.equal(payload.command.id, "target.download");
  assert.equal(Array.isArray(payload.command.flags), true);
  assert.equal(Array.isArray(payload.command.positionals), true);
  assert.equal(Array.isArray(payload.command.examples), true);
  assert.equal(payload.command.flags.includes("--download-out-dir"), true);
  assert.equal(payload.command.positionals.includes("targetId"), true);
});

test("contract --commands returns compact multi-command schemas", () => {
  const result = runCli(["contract", "--commands", "open,target.click,target read"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "commands");
  assert.equal(payload.commandCount, 3);
  assert.equal(Array.isArray(payload.commands), true);
  assert.equal(payload.commands[0]?.id, "open");
  assert.equal(payload.commands[1]?.id, "target.click");
  assert.equal(payload.commands[2]?.id, "target.read");
  assert.equal(Array.isArray(payload.commands[1]?.flags), true);
});

test("contract --core --search run exposes runnable plan guidance", () => {
  const result = runCli(["contract", "--core", "--search", "run"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.commands.some((entry) => entry.id === "run"), true);
  const runGuidance = payload.guidance.find((entry) => entry.id === "run");
  assert.notEqual(runGuidance, undefined);
  assert.equal(Array.isArray(runGuidance.examples), true);
  assert.equal(runGuidance.examples.some((entry) => entry.includes("Supported step ids:")), true);
  assert.equal(runGuidance.examples.some((entry) => entry.includes("repeat-until")), true);
  assert.equal(runGuidance.examples.some((entry) => entry.includes("\"result\"")), true);
  assert.equal(runGuidance.examples.some((entry) => entry.includes("untilDeltaGte")), true);
  assert.equal(runGuidance.examples.some((entry) => entry.includes("\"require\"")), true);
});

test("contract --core --search attr exposes target.attr guidance", () => {
  const result = runCli(["contract", "--core", "--search", "attr"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.commands.some((entry) => entry.id === "target.attr"), true);
  const guidance = payload.guidance.find((entry) => entry.id === "target.attr");
  assert.notEqual(guidance, undefined);
  assert.equal(Array.isArray(guidance.examples), true);
  assert.equal(guidance.examples.some((entry) => entry.includes("--name src")), true);
});

test("contract rejects incompatible mode flags", () => {
  const result = runCli(["contract", "--core", "--full"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("contract --command tolerates extra mode/search flags and still resolves command payload", () => {
  const result = runCli(["contract", "--command", "open", "--search", "open", "--core"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "command");
  assert.equal(payload.command.id, "open");
});

test("contract rejects mixed --command and --commands", () => {
  const result = runCli(["contract", "--command", "open", "--commands", "target.click"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("contract --command resolves CLI path form (space path)", () => {
  const result = runCli(["contract", "--command", "target snapshot"]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "command");
  assert.equal(payload.command.id, "target.snapshot");
  assert.equal(Array.isArray(payload.command.argvPath), true);
  assert.equal(payload.command.argvPath[0], "target");
  assert.equal(payload.command.argvPath[1], "snapshot");
});

test("contract --command unknown id returns recovery suggestions", () => {
  const result = runCli(["contract", "--command", "target"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
  assert.equal(Array.isArray(payload.hints), true);
  assert.equal(payload.hints.some((hint) => hint.includes("Closest command ids:")), true);
  assert.equal(payload.recovery?.strategy, "discover-command-id");
  assert.equal(typeof payload.recovery?.nextCommand, "string");
});

test("target commands detect swapped handle types with typed recovery", () => {
  const state = baseState();
  state.activeSessionId = "s-1";
  state.sessions["s-1"] = {
    sessionId: "s-1",
    kind: "attached",
    cdpOrigin: "http://127.0.0.1:1",
    browserMode: "unknown",
    profile: null,
    debugPort: null,
    userDataDir: null,
    browserPid: null,
    ownerId: null,
    policy: "persistent",
    leaseExpiresAt: null,
    leaseTtlMs: null,
    managedUnreachableSince: null,
    managedUnreachableCount: 0,
    createdAt: "2026-02-25T00:00:00.000Z",
    lastSeenAt: "2026-02-25T00:00:00.000Z",
  };
  writeState(state);

  const result = runCli(["target", "snapshot", "s-1", "--session", "s-1", "--timeout-ms", "200"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_HANDLE_TYPE_MISMATCH");
  assert.equal(payload.recovery?.strategy, "swap-handle-type");
  assert.equal(typeof payload.recovery?.nextCommand, "string");
});
