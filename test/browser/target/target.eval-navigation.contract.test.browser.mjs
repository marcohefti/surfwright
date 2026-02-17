import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-eval-nav-"));
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

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

test("target eval tolerates navigation triggered by evaluation when persisting state", () => {
  requireBrowser();

  const page1 = "<title>Page 1</title><main>one</main>";
  const page1Url = `data:text/html,${encodeURIComponent(page1)}`;

  const openResult = runCli(["--json", "open", page1Url, "--timeout-ms", "8000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  // This triggers a navigation while SurfWright is still in the command, which used to fail during persist (page.title()).
  const navResult = runCli([
    "--json",
    "target",
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

  const hrefResult = runCli(["--json", "target", "eval", openPayload.targetId, "--expr", "location.href", "--timeout-ms", "8000"]);
  assert.equal(hrefResult.status, 0);
  const hrefPayload = parseJson(hrefResult.stdout);
  assert.equal(hrefPayload.result.type, "string");
  assert.equal(hrefPayload.result.value, "about:blank");
});
