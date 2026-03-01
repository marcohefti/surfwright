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
  const listResult = runCli(["session.list"]);
  assert.equal(listResult.status, 0);
  const listPayload = parseJson(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.equal(Array.isArray(listPayload.sessions), true);

  const pruneResult = runCli(["target.prune"]);
  assert.equal(pruneResult.status, 0);
  const prunePayload = parseJson(pruneResult.stdout);
  assert.equal(prunePayload.ok, true);
  assert.equal(typeof prunePayload.removed, "number");

  const reconcileResult = runCli(["state.reconcile", "--timeout-ms", "200"]);
  assert.equal(reconcileResult.status, 0);
  const reconcilePayload = parseJson(reconcileResult.stdout);
  assert.equal(reconcilePayload.ok, true);
  assert.equal(typeof reconcilePayload.sessions.removed, "number");

  const evalResult = runCli(["target.eval", "DEADBEEF", "--expression", "1 + 1"]);
  assert.equal(evalResult.status, 1);
  const evalPayload = parseJson(evalResult.stdout);
  assert.equal(evalPayload.ok, false);
  assert.equal(evalPayload.code, "E_TARGET_SESSION_UNKNOWN");
});

test("help paths are disabled and return typed query failure", () => {
  const helpResult = runCli(["help", "target.dialog"]);
  assert.equal(helpResult.status, 1);
  const payload = parseJson(helpResult.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("contract --search is rejected (discovery is command-id based)", () => {
  const result = runCli(["contract", "--search", "target"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("dot-command alias routes session.clear canonical scoped form", () => {
  const clearResult = runCli(["session.clear", "--session", "s-missing", "--keep-processes", "--timeout-ms", "200"]);
  assert.equal(clearResult.status, 1);
  const clearPayload = parseJson(clearResult.stdout);
  assert.equal(clearPayload.ok, false);
  assert.equal(clearPayload.code, "E_SESSION_NOT_FOUND");
});

test("dot-command alias supports network subcommands", () => {
  const result = runCli(["target.network-query", "--preset", "summary"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");

  const traceResult = runCli(["target.trace.insight"]);
  assert.equal(traceResult.status, 1);
  const tracePayload = parseJson(traceResult.stdout);
  assert.equal(tracePayload.ok, false);
  assert.equal(tracePayload.code, "E_QUERY_INVALID");

  const extensionList = runCli(["extension.list"]);
  assert.equal(extensionList.status, 0);
  const extensionPayload = parseJson(extensionList.stdout);
  assert.equal(extensionPayload.ok, true);
  assert.equal(Array.isArray(extensionPayload.extensions), true);
});

test("agent no-arg probes redirect to contract command lookup", () => {
  const openResult = runCli(["open"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.mode, "command");
  assert.equal(openPayload.command.id, "open");

  const clickResult = runCli(["target.click"]);
  assert.equal(clickResult.status, 0);
  const clickPayload = parseJson(clickResult.stdout);
  assert.equal(clickPayload.ok, true);
  assert.equal(clickPayload.mode, "command");
  assert.equal(clickPayload.command.id, "target.click");
});

test("json shape lint for pure commands (keys only)", () => {
  const contractResult = runCli(["contract"]);
  assert.equal(contractResult.status, 0);
  assert.deepEqual(Object.keys(parseJson(contractResult.stdout)), [
    "ok",
    "name",
    "version",
    "contractSchemaVersion",
    "contractFingerprint",
    "commandCount",
    "errorCount",
    "guarantees",
    "commandIds",
    "errorCodes",
  ]);

  const doctorResult = runCli(["doctor"]);
  assert.equal(doctorResult.status, 0);
  assert.deepEqual(Object.keys(parseJson(doctorResult.stdout)), ["ok", "node", "chrome"]);

  const skillDoctor = runCli(["skill", "doctor"]);
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

  const sessionList = runCli(["session", "list"]);
  assert.equal(sessionList.status, 0);
  assert.deepEqual(Object.keys(parseJson(sessionList.stdout)), ["ok", "activeSessionId", "sessions"]);
});

test("handle-based state lint from contract usage strings", () => {
  const contract = parseJson(runCli(["contract"]).stdout);

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
    assert.equal(contract.commandIds.includes(id), true, `missing command id in compact contract: ${id}`);
    const lookup = parseJson(runCli(["contract", "--command", id]).stdout);
    const cmd = lookup.command;
    assert.equal(typeof cmd.usage, "string");
    assert.ok(cmd.usage.includes("<targetId>"), `${id} usage must include <targetId>`);
    assert.ok(cmd.usage.includes("--session <id>"), `${id} usage must include --session <id>`);
  }
});

test("global --help is disabled with typed failure", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});
