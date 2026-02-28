import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-effects-browser-");
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

  const doctor = runCli(["doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

function openTarget(url, { timeoutMs = 5000 } = {}) {
  const args = ["open", url, "--timeout-ms", String(timeoutMs)];
  const result = runCli(args);
  assert.equal(
    result.status,
    0,
    result.stdout.trim().length > 0 ? result.stdout : result.stderr.trim().length > 0 ? result.stderr : "open failed",
  );
  return parseJson(result.stdout);
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("target scroll-plan returns deterministic shape", () => {
  requireBrowser();
  const html = `<title>Scroll Plan</title><main style="height:4000px"><h1>scroll-page</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const planResult = runCli(["target",
    "scroll-plan",
    openPayload.targetId,
    "--steps",
    "0,120,1200",
    "--settle-ms",
    "0",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(planResult.status, 0);
  const payload = parseJson(planResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.actionId, "string");
  assert.equal(Array.isArray(payload.steps), true);
  assert.equal(payload.steps.length, 3);
  assert.equal(typeof payload.maxScroll, "number");
  assert.equal(typeof payload.viewport.width, "number");
  assert.equal(typeof payload.viewport.height, "number");
  assert.equal(payload.countQuery, null);
  assert.equal(payload.countSummary, null);
  assert.equal(payload.steps[0].requestedY, 0);
  assert.equal(payload.steps[0].requestedUnit, "px");
  assert.equal(payload.steps[0].count, null);
  assert.equal(typeof payload.steps[2].achievedY, "number");
  assert.equal(typeof payload.steps[2].deltaY, "number");
});

test("target scroll-plan can sample selector counts per step", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Scroll Plan Count</title></head>
  <body style="height:3600px;margin:0">
  <main id="list" style="padding-top:1200px"></main>
  <script>
    const list = document.getElementById("list");
    const addChunk = (n) => {
      const el = document.createElement("div");
      el.className = "chunk";
      el.textContent = "chunk-" + n;
      el.style.height = "60px";
      list.appendChild(el);
    };
    for (let i = 1; i <= 3; i += 1) addChunk(i);
    let loaded = false;
    window.addEventListener("scroll", () => {
      if (!loaded && window.scrollY > 300) {
        addChunk(4);
        addChunk(5);
        loaded = true;
      }
    }, { passive: true });
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const planResult = runCli(["target",
    "scroll-plan",
    openPayload.targetId,
    "--steps",
    "0,1,1",
    "--count-selector",
    ".chunk",
    "--settle-ms",
    "150",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(planResult.status, 0);
  const payload = parseJson(planResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.countQuery.selector, ".chunk");
  assert.equal(payload.countQuery.visibleOnly, false);
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.steps[1].requestedUnit, "ratio");
  assert.equal(payload.steps[2].requestedUnit, "ratio");
  assert.equal(typeof payload.steps[0].count, "number");
  assert.equal(payload.steps[0].count <= payload.steps[2].count, true);
  assert.equal(payload.countSummary.sampleCount, payload.steps.length);
  assert.equal(payload.countSummary.last, payload.steps[payload.steps.length - 1].count);
});

test("target scroll-plan supports relative mode deltas", () => {
  requireBrowser();
  const html = `<title>Scroll Plan Relative</title><main style="height:5000px"><h1>scroll-page</h1></main>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const planResult = runCli(["target",
    "scroll-plan",
    openPayload.targetId,
    "--mode",
    "relative",
    "--steps",
    "250,250,250",
    "--settle-ms",
    "0",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(planResult.status, 0);
  const payload = parseJson(planResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "relative");
  assert.equal(payload.steps.length, 3);
  assert.equal(payload.steps[0].requestedUnit, "px");
  assert.equal(payload.steps[1].achievedY >= payload.steps[0].achievedY, true);
  assert.equal(payload.steps[2].achievedY >= payload.steps[1].achievedY, true);
});

test("target transition-trace captures transition events after click", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Transition Trace</title>
  <style>
    #box { opacity: 1; transition: opacity 0.2s ease; }
    body.faded #box { opacity: 0.2; }
  </style>
  </head><body>
  <div id="box">box</div>
  <button id="btn" onclick="document.body.classList.toggle('faded')">Toggle</button>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const traceResult = runCli(["target",
    "transition-trace",
    openPayload.targetId,
    "--click-selector",
    "#btn",
    "--capture-ms",
    "800",
    "--max-events",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(traceResult.status, 0);
  const payload = parseJson(traceResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.actionId, "string");
  assert.equal(typeof payload.captureMs, "number");
  assert.equal(typeof payload.maxEvents, "number");
  assert.equal(typeof payload.eventCount, "number");
  assert.equal(Array.isArray(payload.events), true);
  assert.equal(payload.trigger.mode, "selector");
  assert.equal(payload.trigger.query, "#btn");
  assert.equal(typeof payload.trigger.clicked.selectorHint, "string");
  assert.equal(payload.events.some((entry) => entry.kind === "transitionstart"), true);
  assert.equal(payload.events.some((entry) => entry.propertyName === "opacity"), true);
});

test("target observe captures sampled property changes", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Observe</title></head><body>
  <div id="auto" style="width:80px;height:30px;transform:translateX(0px)">auto</div>
  <script>
    let step = 0;
    setInterval(() => {
      step += 1;
      const el = document.getElementById("auto");
      if (el) {
        el.style.transform = "translateX(" + (step * 8) + "px)";
      }
    }, 120);
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const observeResult = runCli(["target",
    "observe",
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
    "20",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(observeResult.status, 0);
  const payload = parseJson(observeResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.query.selector, "#auto");
  assert.equal(payload.property, "transform");
  assert.equal(Array.isArray(payload.samples), true);
  assert.equal(payload.sampleCount, payload.samples.length);
  assert.equal(payload.sampleCount > 2, true);
  assert.equal(payload.changes > 0, true);
});

test("target scroll-sample returns sampled values across steps", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Scroll Sample</title></head>
  <body style="height:4000px;margin:0">
  <div id="probe" style="position:fixed;top:10px;left:10px;transform:translateY(0px)">probe</div>
  <script>
    const probe = document.getElementById("probe");
    const apply = () => {
      if (probe) {
        probe.style.transform = "translateY(" + Math.round(window.scrollY / 2) + "px)";
      }
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const sampleResult = runCli(["target",
    "scroll-sample",
    openPayload.targetId,
    "--selector",
    "#probe",
    "--property",
    "transform",
    "--steps",
    "0,200,800",
    "--settle-ms",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(sampleResult.status, 0);
  const payload = parseJson(sampleResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.query.selector, "#probe");
  assert.equal(payload.property, "transform");
  assert.equal(Array.isArray(payload.steps), true);
  assert.equal(payload.steps.length, 3);
  assert.equal(typeof payload.steps[0].value, "string");
  assert.equal(payload.valueChanges > 0, true);
});

test("target scroll-watch returns class/style deltas and transition events", () => {
  requireBrowser();
  const html = `<!doctype html>
  <html><head><title>Scroll Watch</title>
  <style>
    body { margin: 0; height: 4000px; }
    #hdr { position: fixed; top: 0; left: 0; right: 0; height: 48px; opacity: 1; transition: opacity 0.15s linear; background: #222; color: #fff; }
    body.scrolled #hdr { opacity: 0.6; }
  </style>
  </head><body>
  <header id="hdr">Header</header>
  <script>
    const apply = () => {
      if (window.scrollY > 120) {
        document.body.classList.add("scrolled");
      } else {
        document.body.classList.remove("scrolled");
      }
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
  </script>
  </body></html>`;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openPayload = openTarget(dataUrl);

  const watchResult = runCli(["target",
    "scroll-watch",
    openPayload.targetId,
    "--selector",
    "#hdr",
    "--properties",
    "opacity,position",
    "--steps",
    "0,180,0",
    "--settle-ms",
    "300",
    "--max-events",
    "120",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(watchResult.status, 0);
  const payload = parseJson(watchResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(payload.query.selector, "#hdr");
  assert.equal(Array.isArray(payload.samples), true);
  assert.equal(payload.samples.length, 3);
  assert.equal(payload.changeCount > 0, true);
  assert.equal(typeof payload.transition.emitted, "number");
  assert.equal(payload.transition.emitted > 0, true);
});
