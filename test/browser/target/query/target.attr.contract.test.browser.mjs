import assert from "node:assert/strict";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-attr-");
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
  const result = runCli(["doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

function fixtureUrl() {
  const baseOrigin = "http://127.0.0.1";
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Attr Fixture</title>
        <base href="${baseOrigin}/docs/" />
      </head>
      <body>
        <main>
          <img id="avatar" class="avatar" src="/img/avatar.jpg" alt="Avatar" />
          <a class="item" href="/pricing">Pricing</a>
          <a class="item" href="/enterprise">Enterprise</a>
        </main>
      </body>
    </html>`;
  return `data:text/html,${encodeURIComponent(html)}`;
}

test("target attr resolves relative URL attributes to absolute URLs", () => {
  requireBrowser();
  const openResult = runCli(["open", fixtureUrl(), "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const attrResult = runCli(["target",
    "attr",
    openPayload.targetId,
    "--selector",
    "img#avatar",
    "--name",
    "src",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(attrResult.status, 0);
  const payload = parseJson(attrResult.stdout);

  assert.deepEqual(Object.keys(payload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "mode",
    "selector",
    "contains",
    "visibleOnly",
    "query",
    "frameScope",
    "attribute",
    "requestedIndex",
    "matchCount",
    "pickedIndex",
    "attributePresent",
    "value",
    "picked",
    "timingMs",
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.sessionId, openPayload.sessionId);
  assert.equal(payload.sessionSource, "target-inferred");
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.mode, "selector");
  assert.equal(payload.attribute, "src");
  assert.equal(payload.matchCount, 1);
  assert.equal(payload.pickedIndex, 0);
  assert.equal(payload.attributePresent, true);
  assert.equal(payload.value, "http://127.0.0.1/img/avatar.jpg");
  assert.equal(payload.picked.frameId, "f-0");
  assert.equal(payload.picked.tag, "img");
});

test("target attr supports --nth for deterministic multi-match selection", () => {
  requireBrowser();
  const openResult = runCli(["open", fixtureUrl(), "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const secondLink = runCli(["target",
    "attr",
    openPayload.targetId,
    "--selector",
    "a.item",
    "--name",
    "href",
    "--nth",
    "2",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(secondLink.status, 0);
  const secondPayload = parseJson(secondLink.stdout);
  assert.equal(secondPayload.pickedIndex, 1);
  assert.equal(secondPayload.value, "http://127.0.0.1/enterprise");
  assert.equal(secondPayload.picked.text, "Enterprise");

  const outOfRange = runCli(["target",
    "attr",
    openPayload.targetId,
    "--selector",
    "a.item",
    "--name",
    "href",
    "--nth",
    "9",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(outOfRange.status, 1);
  const failure = parseJson(outOfRange.stdout);
  assert.equal(failure.code, "E_QUERY_INVALID");
});
