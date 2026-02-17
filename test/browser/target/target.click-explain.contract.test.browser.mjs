import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-explain-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_TEST_BROWSER: "1",
    },
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

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target click --explain returns bounded rejection reasons without clicking", () => {
  requireBrowser();
  const html = `<title>Click Explain</title><main><button style=\"display:none\">Delete</button><button>Delete</button></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const explainResult = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Delete",
    "--visible-only",
    "--explain",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(explainResult.status, 0);
  const payload = parseJson(explainResult.stdout);

  assert.equal(payload.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "actionId"), false);
  assert.equal(payload.matchCount, 2);
  assert.equal(payload.requestedIndex, null);
  assert.equal(payload.pickedIndex, 1);
  assert.equal(payload.picked.index, 1);
  assert.equal(payload.reason, null);
  assert.equal(Array.isArray(payload.rejected), true);
  assert.equal(payload.rejected.length, 1);
  assert.equal(payload.rejected[0].index, 0);
  assert.equal(payload.rejected[0].reason, "not_visible");
  assert.equal(typeof payload.rejectedTruncated, "boolean");
});
