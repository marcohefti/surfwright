import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-snapshot-phase5-"));

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

  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

let sharedSessionId;
function ensureSharedSession() {
  if (typeof sharedSessionId === "string" && sharedSessionId.length > 0) {
    return sharedSessionId;
  }
  const ensure = runCli(["--json", "session", "ensure", "--timeout-ms", "5000"]);
  assert.equal(ensure.status, 0);
  const payload = parseJson(ensure.stdout);
  sharedSessionId = payload.sessionId;
  return sharedSessionId;
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
        // ignore already-dead processes
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

test("target snapshot accepts 0 for --max-* caps", () => {
  requireBrowser();
  const html = `<title>Snapshot Caps</title><main><h1>Hi</h1><button id="b1">One</button><a href="#a1">A1</a></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const sessionId = ensureSharedSession();
  const openResult = runCli(["--json", "--session", sessionId, "open", dataUrl, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snapResult = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--max-buttons",
    "0",
    "--max-links",
    "0",
    "--max-chars",
    "0",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(snapResult.status, 0);
  const payload = parseJson(snapResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "snapshot");
  assert.deepEqual(payload.buttons, []);
  assert.deepEqual(payload.links, []);
  assert.equal(payload.textPreview, "");
});

test("target snapshot supports paging via --cursor", () => {
  requireBrowser();
  const html = `
    <title>Snapshot Paging</title>
    <main>
      <a href="#l1">Link 1</a>
      <a href="#l2">Link 2</a>
      <a href="#l3">Link 3</a>
      <a href="#l4">Link 4</a>
      <a href="#l5">Link 5</a>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const sessionId = ensureSharedSession();
  const openResult = runCli(["--json", "--session", sessionId, "open", dataUrl, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const first = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--max-chars",
    "0",
    "--max-headings",
    "0",
    "--max-buttons",
    "0",
    "--max-links",
    "2",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(first.status, 0);
  const firstPayload = parseJson(first.stdout);
  assert.equal(firstPayload.ok, true);
  assert.deepEqual(
    firstPayload.links.map((entry) => entry.text),
    ["Link 1", "Link 2"],
  );
  assert.equal(firstPayload.nextCursor, "h=0;b=0;l=2");

  const second = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--cursor",
    firstPayload.nextCursor,
    "--max-chars",
    "0",
    "--max-headings",
    "0",
    "--max-buttons",
    "0",
    "--max-links",
    "2",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(second.status, 0);
  const secondPayload = parseJson(second.stdout);
  assert.equal(secondPayload.ok, true);
  assert.equal(secondPayload.cursor, "h=0;b=0;l=2");
  assert.deepEqual(
    secondPayload.links.map((entry) => entry.text),
    ["Link 3", "Link 4"],
  );
  assert.equal(secondPayload.nextCursor, "h=0;b=0;l=4");

  const third = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--cursor",
    secondPayload.nextCursor,
    "--max-chars",
    "0",
    "--max-headings",
    "0",
    "--max-buttons",
    "0",
    "--max-links",
    "2",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(third.status, 0);
  const thirdPayload = parseJson(third.stdout);
  assert.equal(thirdPayload.ok, true);
  assert.deepEqual(
    thirdPayload.links.map((entry) => entry.text),
    ["Link 5"],
  );
  assert.equal(thirdPayload.nextCursor, null);
});

test("target snapshot --include-selector-hints returns bounded selectorHint rows", () => {
  requireBrowser();
  const html = `
    <title>Snapshot Hints</title>
    <main>
      <h1 id="top" class="a b c">Heading</h1>
      <button id="go" class="btn primary">Go</button>
      <a id="x" class="l1 l2" href="#x">X</a>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const sessionId = ensureSharedSession();
  const openResult = runCli(["--json", "--session", sessionId, "open", dataUrl, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snap = runCli([
    "--json",
    "target",
    "snapshot",
    openPayload.targetId,
    "--include-selector-hints",
    "--max-chars",
    "0",
    "--max-headings",
    "1",
    "--max-buttons",
    "1",
    "--max-links",
    "1",
    "--timeout-ms",
    "20000",
  ]);
  assert.equal(snap.status, 0);
  const payload = parseJson(snap.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "snapshot");
  assert.equal(payload.items.headings[0].selectorHint, "h1#top.a.b");
  assert.equal(payload.items.buttons[0].selectorHint, "button#go.btn.primary");
  assert.equal(payload.items.links[0].selectorHint, "a#x.l1.l2");
});

test("target snapshot --mode orient returns a quiet orientation payload", () => {
  requireBrowser();
  const html = `
    <title>Orient</title>
    <header>
      <nav>
        <a href="#one">One</a>
        <a href="#two">Two</a>
      </nav>
    </header>
    <main>
      <h1>Welcome</h1>
      <a href="#body">Body</a>
      <button>Click</button>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;

  const sessionId = ensureSharedSession();
  const openResult = runCli(["--json", "--session", sessionId, "open", dataUrl, "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const snap = runCli(["--json", "target", "snapshot", openPayload.targetId, "--mode", "orient", "--timeout-ms", "20000"]);
  assert.equal(snap.status, 0);
  const payload = parseJson(snap.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "orient");
  assert.equal(payload.h1, "Welcome");
  assert.deepEqual(payload.buttons, []);
  assert.deepEqual(
    payload.links.map((entry) => entry.text),
    ["One", "Two"],
  );
});
