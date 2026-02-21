import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-click-index-");
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

test("target click supports --index for deterministic multi-match selection", () => {
  requireBrowser();
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>Click Index</title></head>
      <body>
        <main>
          <button id="add">Add Element</button>
          <div id="container"></div>
        </main>
        <script>
          const container = document.getElementById('container');
          document.getElementById('add').addEventListener('click', () => {
            const btn = document.createElement('button');
            btn.className = 'added-manually';
            btn.textContent = 'Delete';
            btn.addEventListener('click', () => btn.remove());
            container.appendChild(btn);
          });
        </script>
      </body></html>`;
  const url = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
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

test("target click supports --repeat for deterministic multi-action loops", () => {
  requireBrowser();
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>Click Repeat</title></head>
      <body>
        <main>
          <button id="add">Add Element</button>
          <div id="count">0</div>
        </main>
        <script>
          const countNode = document.getElementById('count');
          document.getElementById('add').addEventListener('click', () => {
            const next = Number.parseInt(countNode.textContent || '0', 10) + 1;
            countNode.textContent = String(next);
          });
        </script>
      </body></html>`;
  const url = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const repeatClick = runCli([
    "--json",
    "--output-shape",
    "compact",
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Add Element",
    "--visible-only",
    "--repeat",
    "3",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(repeatClick.status, 0);
  const repeatPayload = parseJson(repeatClick.stdout);
  assert.equal(repeatPayload.ok, true);
  assert.equal(typeof repeatPayload.actionId, "string");
  assert.equal(typeof repeatPayload.repeat, "object");
  assert.equal(repeatPayload.repeat.requested, 3);
  assert.equal(repeatPayload.repeat.completed, 3);
  assert.equal(Array.isArray(repeatPayload.repeat.actionIds), true);
  assert.equal(repeatPayload.repeat.actionIds.length, 3);
  assert.equal(Array.isArray(repeatPayload.repeat.pickedIndices), true);
  assert.equal(repeatPayload.repeat.pickedIndices.length, 3);

  const countResult = runCli([
    "--json",
    "target",
    "eval",
    openPayload.targetId,
    "--expr",
    "document.querySelector('#count')?.textContent",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(countResult.status, 0);
  const countPayload = parseJson(countResult.stdout);
  assert.equal(countPayload.result.value, "3");

  const explainRepeat = runCli([
    "--json",
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Add Element",
    "--explain",
    "--repeat",
    "2",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(explainRepeat.status, 1);
  const explainPayload = parseJson(explainRepeat.stdout);
  assert.equal(explainPayload.code, "E_QUERY_INVALID");
});

test("target find returns href and tag metadata for each match", () => {
  requireBrowser();
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>Find Metadata Contract</title></head>
      <body>
        <main>
          <a id="repo-link" href="#repo">Repository</a>
          <h2 id="repo-heading">Repository heading</h2>
          <button id="repo-btn">Repository action</button>
        </main>
      </body>
    </html>`;
  const url = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const found = runCli([
    "--json",
    "target",
    "find",
    openPayload.targetId,
    "--text",
    "Repository",
    "--visible-only",
    "--limit",
    "10",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(found.status, 0, found.stdout || found.stderr);
  const payload = parseJson(found.stdout);

  assert.equal(payload.ok, true);
  assert.equal(Array.isArray(payload.matches), true);
  assert.ok(payload.matches.length >= 3);
  for (const match of payload.matches) {
    assert.equal(Object.prototype.hasOwnProperty.call(match, "href"), true);
    assert.equal(Object.prototype.hasOwnProperty.call(match, "tag"), true);
    assert.ok(match.href === null || typeof match.href === "string");
    assert.ok(match.tag === null || typeof match.tag === "string");
  }

  const linkMatch = payload.matches.find((entry) => entry.selectorHint === "a#repo-link");
  assert.ok(linkMatch, "Expected link match");
  assert.equal(linkMatch.tag, "a");
  assert.equal(typeof linkMatch.href, "string");
  assert.ok(linkMatch.href.includes("#repo"));

  const headingMatch = payload.matches.find((entry) => entry.selectorHint === "h2#repo-heading");
  assert.ok(headingMatch, "Expected heading match");
  assert.equal(headingMatch.tag, "h2");
  assert.equal(headingMatch.href, null);
});

test("target find supports href host/path filtering for deterministic link narrowing", () => {
  requireBrowser();
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>Find Href Filters</title></head>
      <body>
        <main>
          <a id="good" href="http://localhost/marcohefti/surfwright">Repo Good</a>
          <a id="other-host" href="http://127.0.0.1/marcohefti/surfwright">Repo Other Host</a>
          <a id="other-path" href="http://localhost/openai/codex">Repo Other Path</a>
        </main>
      </body>
    </html>`;
  const url = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", url, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const filtered = runCli([
    "--json",
    "target",
    "find",
    openPayload.targetId,
    "--text",
    "Repo",
    "--href-host",
    "localhost",
    "--href-path-prefix",
    "/marcohefti/",
    "--visible-only",
    "--limit",
    "10",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(filtered.status, 0, filtered.stdout || filtered.stderr);
  const payload = parseJson(filtered.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.hrefHost, "localhost");
  assert.equal(payload.hrefPathPrefix, "/marcohefti/");
  assert.equal(payload.count, 1);
  assert.equal(payload.matches.length, 1);
  assert.equal(payload.matches[0].selectorHint, "a#good");
  assert.equal(payload.matches[0].href, "http://localhost/marcohefti/surfwright");
});
