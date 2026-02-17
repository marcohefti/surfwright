import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-eval-expr-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });

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
  const result = runCli(["--json", "doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target eval supports --expr to return expression values without explicit return", () => {
  requireBrowser();
  const html = "<title>Eval Expr</title><main>ok</main>";
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const functionBodyResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "document.title",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(functionBodyResult.status, 0);
  const functionBodyPayload = parseJson(functionBodyResult.stdout);
  assert.deepEqual(Object.keys(functionBodyPayload), [
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
  assert.equal(functionBodyPayload.result.type, "undefined");
  assert.equal(functionBodyPayload.result.value, null);
  assert.equal(functionBodyPayload.context.evaluatedFrameId, "f-0");
  assert.equal(functionBodyPayload.context.world, "main");

  const exprResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--expr",
    "document.title",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(exprResult.status, 0);
  const exprPayload = parseJson(exprResult.stdout);
  assert.equal(exprPayload.result.type, "string");
  assert.equal(exprPayload.result.value, "Eval Expr");
  assert.equal(exprPayload.context.evaluatedFrameId, "f-0");
});
