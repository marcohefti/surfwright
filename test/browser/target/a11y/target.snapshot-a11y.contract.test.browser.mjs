import assert from "node:assert/strict";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-snapshot-a11y-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });

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
  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target snapshot --mode a11y returns bounded rows and supports ax cursor paging", () => {
  requireBrowser();
  const html = `
    <title>Snapshot A11y</title>
    <main>
      <h1>Welcome</h1>
      <a href="#one">One</a>
      <a href="#two">Two</a>
      <button>Go</button>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "8000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const first = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "snapshot",
    openPayload.targetId,
    "--mode",
    "a11y",
    "--max-ax-rows",
    "2",
    "--timeout-ms",
    "8000",
  ]);
  assert.equal(first.status, 0);
  const firstPayload = parseJson(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.mode, "a11y");
  assert.equal(typeof firstPayload.a11y, "object");
  assert.equal(Array.isArray(firstPayload.a11y.rows), true);
  assert.ok(firstPayload.a11y.rows.length <= 2);
  assert.equal(typeof firstPayload.a11y.total, "number");

  if (firstPayload.nextCursor !== null) {
    assert.equal(typeof firstPayload.nextCursor, "string");
    assert.ok(firstPayload.nextCursor.startsWith("ax="));

    const second = runCli([
      "--json",
      "--session",
      ensurePayload.sessionId,
      "target",
      "snapshot",
      openPayload.targetId,
      "--mode",
      "a11y",
      "--cursor",
      firstPayload.nextCursor,
      "--max-ax-rows",
      "2",
      "--timeout-ms",
      "8000",
    ]);
    assert.equal(second.status, 0);
    const secondPayload = parseJson(second.stdout);
    assert.equal(secondPayload.ok, true);
    assert.equal(secondPayload.mode, "a11y");
    assert.equal(secondPayload.cursor, firstPayload.nextCursor);
  }
});

