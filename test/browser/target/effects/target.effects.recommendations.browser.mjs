import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-effects-reco-browser-"));

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

function cleanupManagedBrowsers() {
  try {
    const statePath = stateFilePath();
    if (!fs.existsSync(statePath)) {
      return;
    }
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sessions = state?.sessions ?? {};
    for (const session of Object.values(sessions)) {
      if (!session || typeof session !== "object" || session.kind !== "managed") {
        continue;
      }
      if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
        continue;
      }
      try {
        process.kill(session.browserPid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
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

test("target hover returns style diffs", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Hover</title>
  <style>
    #cta { color: rgb(0, 0, 0); background: rgb(255, 255, 255); }
    #cta:hover { color: rgb(255, 255, 255); background: rgb(0, 128, 0); transform: translateY(-2px); }
  </style>
  </head><body>
  <button id="cta">Pay</button>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const hoverResult = runCli([
    "--json",
    "target",
    "hover",
    openPayload.targetId,
    "--selector",
    "#cta",
    "--properties",
    "color,background-color,transform",
    "--settle-ms",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(hoverResult.status, 0);
  const payload = parseJson(hoverResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.changedCount > 0, true);
  assert.equal(Array.isArray(payload.diffs), true);
});

test("target sticky-check reports sticky evidence", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Sticky</title>
  <style>
    body { margin: 0; height: 4000px; }
    header { position: sticky; top: 0; height: 48px; background: #111; color: #fff; }
  </style>
  </head><body>
  <header id="hdr">Header</header>
  <main style="height:3800px"></main>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const stickyResult = runCli([
    "--json",
    "target",
    "sticky-check",
    openPayload.targetId,
    "--selector",
    "#hdr",
    "--steps",
    "0,220,640,0",
    "--settle-ms",
    "150",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(stickyResult.status, 0);
  const payload = parseJson(stickyResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.sticky, "boolean");
  assert.equal(payload.sticky, true);
});

test("target motion-detect reports autonomous movement", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Motion</title></head><body>
  <div id="auto" style="transform:translateX(0px)">auto</div>
  <script>
    let x = 0;
    setInterval(() => {
      x += 6;
      const el = document.getElementById("auto");
      if (el) el.style.transform = "translateX(" + x + "px)";
    }, 120);
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const motionResult = runCli([
    "--json",
    "target",
    "motion-detect",
    openPayload.targetId,
    "--selector",
    "#auto",
    "--property",
    "transform",
    "--interval-ms",
    "120",
    "--duration-ms",
    "900",
    "--max-samples",
    "30",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(motionResult.status, 0);
  const payload = parseJson(motionResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.motionDetected, true);
});

test("target transition-assert aggregates repeated transitions", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Transition Assert</title>
  <style>
    #box { opacity: 1; transition: opacity 0.2s ease; }
    body.faded #box { opacity: 0.2; }
  </style>
  </head><body>
  <div id="box">box</div>
  <button id="btn" onclick="document.body.classList.toggle('faded')">Toggle</button>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const assertResult = runCli([
    "--json",
    "target",
    "transition-assert",
    openPayload.targetId,
    "--cycles",
    "2",
    "--click-selector",
    "#btn",
    "--capture-ms",
    "700",
    "--max-events",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(assertResult.status, 0);
  const payload = parseJson(assertResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.cycles, 2);
  assert.equal(Array.isArray(payload.runs), true);
  assert.equal(payload.runs.length, 2);
  assert.equal(payload.asserted, true);
});

test("target scroll-reveal-scan reports revealed candidates", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Reveal Scan</title>
  <style>
    body { margin: 0; height: 4000px; }
    .reveal { opacity: 0.2; transform: translateY(30px); transition: opacity 0.15s linear, transform 0.15s linear; margin-top: 900px; }
    body.scrolled .reveal { opacity: 1; transform: translateY(0); }
  </style>
  </head><body>
  <section class="reveal" id="reveal-item">Reveal</section>
  <script>
    const apply = () => {
      if (window.scrollY > 240) document.body.classList.add("scrolled");
      else document.body.classList.remove("scrolled");
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);

  const revealResult = runCli([
    "--json",
    "target",
    "scroll-reveal-scan",
    openPayload.targetId,
    "--max-candidates",
    "5",
    "--steps",
    "0,300,650",
    "--settle-ms",
    "220",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(revealResult.status, 0);
  const payload = parseJson(revealResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.revealedCount, "number");
  assert.equal(payload.scannedCount > 0, true);
  assert.equal(payload.revealedCount > 0, true);
});

