import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-dot-alias-"));

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_DAEMON: "0",
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("dot-command aliases route to runtime/target commands", () => {
  const listResult = runCli(["--json", "session.list"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(Array.isArray(listPayload.sessions), true);

  const pruneResult = runCli(["--json", "target.prune"]);
  assert.equal(pruneResult.status, 0);
  const prunePayload = parseJson(pruneResult.stdout);
  assert.equal(prunePayload.ok, true);
  assert.equal(typeof prunePayload.removed, "number");

  const reconcileResult = runCli(["--json", "state.reconcile", "--timeout-ms", "200"]);
  assert.equal(reconcileResult.status, 0);
  const reconcilePayload = parseJson(reconcileResult.stdout);
  assert.equal(reconcilePayload.ok, true);
  assert.equal(typeof reconcilePayload.sessions.removed, "number");

  const evalResult = runCli(["--json", "target.eval", "DEADBEEF", "--expression", "1 + 1"]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("dot-command alias supports network subcommands", () => {
  const result = runCli(["--json", "target.network-query", "--preset", "summary"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");

  const traceResult = runCli(["--json", "target.trace.insight"]);
  assert.equal(traceResult.status, 1);
  const tracePayload = parseJson(traceResult.stdout);
  assert.equal(tracePayload.ok, false);
  assert.equal(tracePayload.code, "E_QUERY_INVALID");

  const extensionList = runCli(["--json", "extension.list"]);
  assert.equal(extensionList.status, 0);
  const extensionPayload = parseJson(extensionList.stdout);
  assert.equal(extensionPayload.ok, true);
  assert.equal(Array.isArray(extensionPayload.extensions), true);
});

test("json shape lint for pure commands (keys only)", () => {
  const contractResult = runCli(["--json", "contract"]);
  assert.equal(contractResult.status, 0);
  assert.deepEqual(Object.keys(parseJson(contractResult.stdout)), [
    "ok",
    "name",
    "version",
    "contractSchemaVersion",
    "contractFingerprint",
    "guarantees",
    "commands",
    "errors",
  ]);

  const doctorResult = runCli(["--json", "doctor"]);
  assert.equal(doctorResult.status, 0);
  assert.deepEqual(Object.keys(parseJson(doctorResult.stdout)), ["ok", "node", "chrome"]);

  const skillDoctor = runCli(["--json", "skill", "doctor"]);
  assert.equal(skillDoctor.status, 0);
  assert.deepEqual(Object.keys(parseJson(skillDoctor.stdout)), [
    "ok",
    "installed",
    "name",
    "destination",
    "skillVersion",
    "compatible",
    "reason",
    "lockPath",
    "lockStatus",
  ]);

  const sessionList = runCli(["--json", "session", "list"]);
  assert.equal(sessionList.status, 0);
  assert.deepEqual(Object.keys(parseJson(sessionList.stdout)), ["ok", "activeSessionId", "sessions"]);
});

test("handle-based state lint from contract usage strings", () => {
  const contract = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/contract/contract.snapshot.json"), "utf8"));
  const byId = new Map((contract.commands ?? []).map((cmd) => [cmd.id, cmd]));

  const mustHaveTargetIdAndSession = [
    "target.snapshot",
    "target.eval",
    "target.click",
    "target.fill",
    "target.upload",
    "target.keypress",
    "target.drag-drop",
    "target.network",
  ];

  for (const id of mustHaveTargetIdAndSession) {
    const cmd = byId.get(id);
    assert.ok(cmd, `missing command in contract: ${id}`);
    assert.equal(typeof cmd.usage, "string");
    assert.ok(cmd.usage.includes("<targetId>"), `${id} usage must include <targetId>`);
    assert.ok(cmd.usage.includes("--session <id>"), `${id} usage must include --session <id>`);
  }
});

function parseSubcommandsFromHelp(helpText) {
  const lines = String(helpText).split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "Commands:");
  if (startIndex === -1) {
    return [];
  }
  const out = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.trim().length === 0) {
      break;
    }
    // Commander wraps long command descriptions onto subsequent lines. Those lines are
    // heavily indented and often start with regular words (e.g. "coverage") which we
    // must not treat as commands.
    const match =
      /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s{2,}|\s+\[|\s+<|\s*$)/.exec(raw);
    if (!match) {
      continue;
    }
    const indent = match[1].length;
    if (indent > 6) {
      continue;
    }
    const name = match[2];
    if (name === "help" || name.startsWith("__")) {
      continue;
    }
    out.push(name);
  }
  return out;
}

function listRegisteredCommandIdsViaHelp() {
  const leaves = [];
  const queue = [[]];
  const visited = new Set();
  while (queue.length > 0) {
    const pathTokens = queue.pop();
    const visitKey = (pathTokens ?? []).join(" ");
    if (visited.has(visitKey)) {
      continue;
    }
    visited.add(visitKey);
    assert.ok(visited.size < 400, "help traversal exceeded safety cap (possible help parsing bug)");
    const helpResult = runCli([...pathTokens, "--help"]);
    assert.equal(helpResult.status, 0);
    const subcommands = parseSubcommandsFromHelp(helpResult.stdout);
    if (subcommands.length === 0) {
      if (pathTokens.length > 0) {
        leaves.push(pathTokens);
      }
      continue;
    }
    for (const sub of subcommands) {
      queue.push([...pathTokens, sub]);
    }
  }
  return leaves.map((tokens) => tokens.join(".")).sort();
}

test("contract truthfulness: --json contract ids match registered commander commands", () => {
  const helpIds = listRegisteredCommandIdsViaHelp();
  const contractPayload = parseJson(runCli(["--json", "contract"]).stdout);
  const contractIds = (contractPayload.commands ?? []).map((cmd) => cmd.id).sort();

  const helpSet = new Set(helpIds);
  const contractSet = new Set(contractIds);

  const missingInHelp = contractIds.filter((id) => !helpSet.has(id));
  const missingInContract = helpIds.filter((id) => !contractSet.has(id));

  assert.deepEqual(missingInHelp, []);
  assert.deepEqual(missingInContract, []);
});
