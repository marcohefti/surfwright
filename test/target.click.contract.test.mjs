import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-click-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
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

  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function cleanupManagedBrowsers() {
  try {
    const statePath = stateFilePath();
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object") {
        continue;
      }
      if (session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore already-dead process
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

process.on("exit", () => {
  cleanupManagedBrowsers();
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("target click returns deterministic shape for selector/text modes", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Click Contract Test</title>
    <main>
      <button id="cta">Open Blog</button>
      <a id="blog-link" href="#blog">Blog</a>
      <script>
        const cta = document.getElementById('cta');
        if (cta) {
          cta.addEventListener('click', () => {
            document.title = 'Clicked CTA';
            location.hash = 'cta';
          });
        }
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const selectorClick = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "#cta",
    "--visible-only",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(selectorClick.status, 0);
  const selectorPayload = parseJson(selectorClick.stdout);
  assert.deepEqual(Object.keys(selectorPayload), [
    "ok",
    "sessionId",
    "sessionSource",
    "targetId",
    "actionId",
    "mode",
    "selector",
    "contains",
    "visibleOnly",
    "query",
    "clicked",
    "url",
    "title",
    "wait",
    "snapshot",
    "timingMs",
  ]);
  assert.equal(selectorPayload.ok, true);
  assert.equal(selectorPayload.sessionSource, "explicit");
  assert.equal(selectorPayload.mode, "selector");
  assert.equal(selectorPayload.selector, "#cta");
  assert.equal(selectorPayload.query, "#cta");
  assert.equal(selectorPayload.visibleOnly, true);
  assert.equal(typeof selectorPayload.actionId, "string");
  assert.equal(typeof selectorPayload.clicked, "object");
  assert.equal(typeof selectorPayload.clicked.text, "string");
  assert.equal(selectorPayload.wait, null);
  assert.equal(selectorPayload.snapshot, null);
  assert.equal(typeof selectorPayload.timingMs.total, "number");

  const textClick = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--text",
    "Blog",
    "--wait-for-text",
    "Blog",
    "--snapshot",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(textClick.status, 0);
  const textPayload = parseJson(textClick.stdout);
  assert.equal(textPayload.ok, true);
  assert.equal(textPayload.sessionSource, "explicit");
  assert.equal(textPayload.mode, "text");
  assert.equal(textPayload.query, "Blog");
  assert.equal(typeof textPayload.clicked.selectorHint, "string");
  assert.equal(textPayload.clicked.selectorHint.includes("#blog-link"), true);
  assert.equal(textPayload.wait.mode, "text");
  assert.equal(textPayload.wait.value, "Blog");
  assert.equal(typeof textPayload.snapshot.textPreview, "string");
});

test("target click returns typed query failure when no match exists", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Click Missing Test</title><main><button id="exists">Exists</button></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const clickResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "click",
    openPayload.targetId,
    "--selector",
    "#missing",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(clickResult.status, 1);
  const clickPayload = parseJson(clickResult.stdout);
  assert.equal(clickPayload.ok, false);
  assert.equal(clickPayload.code, "E_QUERY_INVALID");
});

test("target fill and form-fill return deterministic compact shapes", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `
    <title>Fill Contract Test</title>
    <form id="profile">
      <input id="email" name="email" />
      <input id="password" name="password" type="password" />
      <input id="agree" name="agree" type="checkbox" />
      <select id="role" name="role">
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
    </form>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const fillResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "fill",
    openPayload.targetId,
    "--selector",
    "#email",
    "--value",
    "person@example.com",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(fillResult.status, 0);
  const fillPayload = parseJson(fillResult.stdout);
  assert.deepEqual(Object.keys(fillPayload), [
    "ok",
    "sessionId",
    "targetId",
    "actionId",
    "query",
    "valueLength",
    "url",
    "title",
    "timingMs",
  ]);
  assert.equal(fillPayload.ok, true);
  assert.equal(fillPayload.sessionId, ensurePayload.sessionId);
  assert.equal(fillPayload.targetId, openPayload.targetId);
  assert.equal(fillPayload.query, "#email");
  assert.equal(fillPayload.valueLength, "person@example.com".length);
  assert.equal(typeof fillPayload.actionId, "string");
  assert.equal(typeof fillPayload.timingMs.total, "number");

  const verifyFillResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return document.querySelector('#email').value",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyFillResult.status, 0);
  const verifyFillPayload = parseJson(verifyFillResult.stdout);
  assert.equal(verifyFillPayload.result.value, "person@example.com");

  const fieldsJson = JSON.stringify({
    "#email": "second@example.com",
    "#password": "s3cret!",
    "#agree": true,
    "#role": "editor",
  });
  const formFillResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "form-fill",
    openPayload.targetId,
    "--fields-json",
    fieldsJson,
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(formFillResult.status, 0);
  const formFillPayload = parseJson(formFillResult.stdout);
  assert.deepEqual(Object.keys(formFillPayload), [
    "ok",
    "sessionId",
    "targetId",
    "actionId",
    "applied",
    "count",
    "submitted",
    "timingMs",
  ]);
  assert.equal(formFillPayload.ok, true);
  assert.equal(formFillPayload.sessionId, ensurePayload.sessionId);
  assert.equal(formFillPayload.targetId, openPayload.targetId);
  assert.equal(formFillPayload.count, 4);
  assert.equal(formFillPayload.submitted, false);
  assert.equal(Array.isArray(formFillPayload.applied), true);
  assert.equal(formFillPayload.applied.length, 4);
  assert.equal(typeof formFillPayload.timingMs.total, "number");

  const verifyFormResult = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "eval",
    openPayload.targetId,
    "--expression",
    "return {email: document.querySelector('#email').value, password: document.querySelector('#password').value, agree: document.querySelector('#agree').checked, role: document.querySelector('#role').value}",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(verifyFormResult.status, 0);
  const verifyFormPayload = parseJson(verifyFormResult.stdout);
  assert.deepEqual(verifyFormPayload.result.value, {
    email: "second@example.com",
    password: "s3cret!",
    agree: true,
    role: "editor",
  });
});

test("target fill and form-fill return typed validation failures", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const html = `<title>Fill Failure Test</title><main><input id="email" /></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const missingQueryFill = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "fill",
    openPayload.targetId,
    "--value",
    "hello",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(missingQueryFill.status, 1);
  const missingQueryPayload = parseJson(missingQueryFill.stdout);
  assert.equal(missingQueryPayload.ok, false);
  assert.equal(missingQueryPayload.code, "E_QUERY_INVALID");

  const invalidJson = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "form-fill",
    openPayload.targetId,
    "--fields-json",
    "{bad-json}",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(invalidJson.status, 1);
  const invalidJsonPayload = parseJson(invalidJson.stdout);
  assert.equal(invalidJsonPayload.ok, false);
  assert.equal(invalidJsonPayload.code, "E_QUERY_INVALID");

  const arrayPayload = runCli([
    "--json",
    "--session",
    ensurePayload.sessionId,
    "target",
    "form-fill",
    openPayload.targetId,
    "--fields-json",
    "[1,2,3]",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(arrayPayload.status, 1);
  const arrayPayloadJson = parseJson(arrayPayload.stdout);
  assert.equal(arrayPayloadJson.ok, false);
  assert.equal(arrayPayloadJson.code, "E_QUERY_INVALID");
});

test("target upload keypress and drag-drop return deterministic shapes", { skip: !hasBrowser() }, () => {
  const ensureResult = runCli(["--json", "session", "ensure", "--timeout-ms", "6000"]);
  assert.equal(ensureResult.status, 0);
  const ensurePayload = parseJson(ensureResult.stdout);

  const fixturePath = path.join(TEST_STATE_DIR, "upload-fixture.txt");
  fs.writeFileSync(fixturePath, "hello upload");
  const html = `
    <title>Interaction Contract Test</title>
    <main>
      <input id="file-input" type="file" />
      <input id="hidden-file" type="file" style="display:none" />
      <button id="upload-trigger" onclick="document.getElementById('hidden-file').click()">Upload</button>
      <input id="search" value="typed value" />
      <div id="drag-source" draggable="true">Card A</div>
      <div id="drop-target">Drop Here</div>
      <div id="drop-result"></div>
      <script>
        const source = document.getElementById('drag-source');
        const target = document.getElementById('drop-target');
        source.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', 'card-a'));
        target.addEventListener('dragover', (event) => event.preventDefault());
        target.addEventListener('drop', (event) => {
          event.preventDefault();
          document.getElementById('drop-result').textContent = event.dataTransfer.getData('text/plain');
        });
      </script>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "--session", ensurePayload.sessionId, "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const uploadDirect = runCli(["--json", "--session", ensurePayload.sessionId, "target", "upload", openPayload.targetId, "--selector", "#file-input", "--file", fixturePath, "--timeout-ms", "5000"]);
  assert.equal(uploadDirect.status, 0);
  const uploadDirectPayload = parseJson(uploadDirect.stdout);
  assert.equal(uploadDirectPayload.mode, "direct-input");
  assert.equal(uploadDirectPayload.fileCount, 1);

  const uploadChooser = runCli(["--json", "--session", ensurePayload.sessionId, "target", "upload", openPayload.targetId, "--selector", "#upload-trigger", "--file", fixturePath, "--timeout-ms", "5000"]);
  assert.equal(uploadChooser.status, 0);
  const uploadChooserPayload = parseJson(uploadChooser.stdout);
  assert.equal(uploadChooserPayload.mode, "filechooser");

  const keypressResult = runCli(["--json", "--session", ensurePayload.sessionId, "target", "keypress", openPayload.targetId, "--selector", "#search", "--key", "Enter", "--timeout-ms", "5000"]);
  assert.equal(keypressResult.status, 0);
  const keypressPayload = parseJson(keypressResult.stdout);
  assert.equal(keypressPayload.key, "Enter");
  assert.equal(keypressPayload.selector, "#search");
  assert.equal(typeof keypressPayload.resultText, "string");

  const dragDropResult = runCli(["--json", "--session", ensurePayload.sessionId, "target", "drag-drop", openPayload.targetId, "--from", "#drag-source", "--to", "#drop-target", "--timeout-ms", "5000"]);
  assert.equal(dragDropResult.status, 0);
  const dragDropPayload = parseJson(dragDropResult.stdout);
  assert.equal(dragDropPayload.result, "dragged");
  assert.equal(dragDropPayload.from, "#drag-source");
  assert.equal(dragDropPayload.to, "#drop-target");

  const verifyDrag = runCli([
    "--json", "--session", ensurePayload.sessionId, "target", "eval", openPayload.targetId,
    "--expression", "return document.querySelector('#drop-result').textContent", "--timeout-ms", "5000",
  ]);
  assert.equal(verifyDrag.status, 0);
  const verifyDragPayload = parseJson(verifyDrag.stdout);
  assert.equal(verifyDragPayload.result.value, "card-a");

  const uploadMissingFile = runCli([
    "--json", "--session", ensurePayload.sessionId, "target", "upload", openPayload.targetId,
    "--selector", "#search", "--file", "/tmp/does-not-exist.txt", "--timeout-ms", "5000",
  ]);
  assert.equal(uploadMissingFile.status, 1);
  assert.equal(parseJson(uploadMissingFile.stdout).code, "E_QUERY_INVALID");

  const keypressMissingSelector = runCli([
    "--json", "--session", ensurePayload.sessionId, "target", "keypress", openPayload.targetId,
    "--selector", "#missing", "--key", "Enter", "--timeout-ms", "5000",
  ]);
  assert.equal(keypressMissingSelector.status, 1);
  assert.equal(parseJson(keypressMissingSelector.stdout).code, "E_QUERY_INVALID");

  const dragDropInvalidSelector = runCli([
    "--json", "--session", ensurePayload.sessionId, "target", "drag-drop", openPayload.targetId,
    "--from", "[[", "--to", "#dst", "--timeout-ms", "5000",
  ]);
  assert.equal(dragDropInvalidSelector.status, 1);
  assert.equal(parseJson(dragDropInvalidSelector.stdout).code, "E_SELECTOR_INVALID");
});
