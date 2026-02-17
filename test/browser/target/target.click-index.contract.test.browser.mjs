import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-index-"));

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

test("target click supports --index for deterministic multi-match selection", () => {
  requireBrowser();
  const openResult = runCli(["--json", "open", "https://the-internet.herokuapp.com/add_remove_elements/", "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  for (let idx = 0; idx < 3; idx += 1) {
    const addResult = runCli([
      "--json",
      "target",
      "click",
      openPayload.targetId,
      "--text",
      "Add Element",
      "--visible-only",
      "--timeout-ms",
      "20000",
    ]);
    assert.equal(addResult.status, 0);
  }

  const beforeFind = runCli([
    "--json",
    "target",
    "find",
    openPayload.targetId,
    "--selector",
    "button.added-manually",
    "--visible-only",
    "--limit",
    "50",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(beforeFind.status, 0);
  const beforePayload = parseJson(beforeFind.stdout);
  assert.equal(beforePayload.count, 3);

  const clickSecond = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "button.added-manually",
    "--visible-only",
    "--index",
    "1",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(clickSecond.status, 0);
  const clickPayload = parseJson(clickSecond.stdout);
  assert.equal(clickPayload.ok, true);
  assert.equal(clickPayload.matchCount, 3);
  assert.equal(clickPayload.pickedIndex, 1);
  assert.equal(clickPayload.clicked.index, 1);

  const afterFind = runCli([
    "--json",
    "target",
    "find",
    openPayload.targetId,
    "--selector",
    "button.added-manually",
    "--visible-only",
    "--limit",
    "50",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(afterFind.status, 0);
  const afterPayload = parseJson(afterFind.stdout);
  assert.equal(afterPayload.count, 2);

  const outOfRange = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "button.added-manually",
    "--index",
    "99",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(outOfRange.status, 1);
  const outPayload = parseJson(outOfRange.stdout);
  assert.equal(outPayload.ok, false);
  assert.equal(outPayload.code, "E_QUERY_INVALID");
});
