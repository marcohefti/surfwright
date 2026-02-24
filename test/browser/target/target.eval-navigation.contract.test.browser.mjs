import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-eval-nav-");
const TIMEOUT_RECOVERY_SCRIPT_PATH = path.join(TEST_STATE_DIR, "timeout-recovery-loop.js");
fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
fs.writeFileSync(
  TIMEOUT_RECOVERY_SCRIPT_PATH,
  "const deadline = Date.now() + 10_000;\nwhile (Date.now() < deadline) {}\n",
  "utf8",
);

const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

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

test("target eval tolerates navigation triggered by evaluation when persisting state", () => {
  requireBrowser();

  const page1 = "<title>Page 1</title><main>one</main>";
  const page1Url = `data:text/html,${encodeURIComponent(page1)}`;

  const openResult = runCli(["open", page1Url, "--timeout-ms", "8000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  // This triggers a navigation while SurfWright is still in the command, which used to fail during persist (page.title()).
  const navResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expr",
    "location.href = \"about:blank\", true",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(navResult.status, 0);
  const navPayload = parseJson(navResult.stdout);
  assert.equal(navPayload.ok, true);

  const hrefResult = runCli(["target", "eval", openPayload.targetId, "--expr", "location.href", "--timeout-ms", "8000"]);
  assert.equal(hrefResult.status, 0);
  const hrefPayload = parseJson(hrefResult.stdout);
  assert.equal(hrefPayload.result.type, "string");
  assert.equal(hrefPayload.result.value, "about:blank");
});

test("target eval timeout performs recovery so follow-up eval remains usable", () => {
  requireBrowser();

  const html = "<title>Eval Timeout Recovery</title><main>ok</main>";
  const pageUrl = `data:text/html,${encodeURIComponent(html)}`;

  const openResult = runCli(["open", pageUrl, "--timeout-ms", "8000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const timeoutResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--script-file",
    TIMEOUT_RECOVERY_SCRIPT_PATH,
    "--timeout-ms",
    "350",
  ]);
  assert.equal(timeoutResult.status, 1);
  const timeoutPayload = parseJson(timeoutResult.stdout);
  assert.equal(timeoutPayload.ok, false);
  assert.equal(["E_EVAL_TIMEOUT", "E_EVAL_RUNTIME"].includes(timeoutPayload.code), true);

  const followupResult = runCli(["target",
    "eval",
    openPayload.targetId,
    "--expr",
    "1 + 1",
    "--timeout-ms",
    "4000",
  ]);
  assert.equal(followupResult.status, 0);
  const followupPayload = parseJson(followupResult.stdout);
  assert.equal(followupPayload.ok, true);
  assert.equal(followupPayload.result.type, "number");
  assert.equal(followupPayload.result.value, 2);
});
