import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function fail(message, details) {
  const payload = { ok: false, message, details: details ?? null };
  // Intentionally machine-readable for agent loops.
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    cliJs: path.join(process.cwd(), "dist", "cli.js"),
    allowNoBrowser: false,
    live: false,
    timeoutMs: 20000,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cli-js") {
      const next = argv[i + 1];
      if (!next) fail("missing --cli-js value");
      out.cliJs = next;
      i += 1;
      continue;
    }
    if (arg === "--allow-no-browser") {
      out.allowNoBrowser = true;
      continue;
    }
    if (arg === "--live") {
      out.live = true;
      continue;
    }
    if (arg === "--timeout-ms") {
      const next = argv[i + 1];
      if (!next) fail("missing --timeout-ms value");
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n <= 0) fail("invalid --timeout-ms value", { value: next });
      out.timeoutMs = n;
      i += 1;
      continue;
    }
    fail("unknown arg", { arg });
  }

  return out;
}

function dataUrl(html) {
  return `data:text/html,${encodeURIComponent(html)}`;
}

function runCliJson(opts, args, envExtra) {
  const env = {
    ...process.env,
    ...envExtra,
  };
  const result = spawnSync(process.execPath, [opts.cliJs, "--json", ...args], {
    encoding: "utf8",
    env,
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = (result.stdout ?? "").trim();
  if (stdout.length === 0) {
    fail("cli produced no stdout", { args, status: result.status, stderr: result.stderr });
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    fail("cli stdout was not valid JSON", { args, status: result.status, stderr: result.stderr, stdout });
  }

  return { status: result.status ?? 0, payload, stderr: result.stderr ?? "" };
}

function runCliNdjson(opts, args, envExtra) {
  const env = {
    ...process.env,
    ...envExtra,
  };
  const result = spawnSync(process.execPath, [opts.cliJs, "--json", ...args], {
    encoding: "utf8",
    env,
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((result.stdout ?? "").trim().length === 0) {
    fail("cli produced no stdout (ndjson)", { args, status: result.status, stderr: result.stderr });
  }
  const lines = (result.stdout ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      fail("cli ndjson line was not valid JSON", { args, status: result.status, stderr: result.stderr, line });
    }
  }
  return { status: result.status ?? 0, events: parsed, stderr: result.stderr ?? "" };
}

function expectOk(label, { status, payload, stderr }, extra) {
  if (status !== 0 || !payload || payload.ok !== true) {
    fail(`${label} failed`, { status, stderr, payload, ...extra });
  }
  return payload;
}

function expectTypedFailure(label, { status, payload, stderr }, expectedCode) {
  if (status === 0 || !payload || payload.ok !== false) {
    fail(`${label} expected typed failure`, { status, stderr, payload, expectedCode });
  }
  if (payload.code !== expectedCode) {
    fail(`${label} wrong failure code`, { status, stderr, payload, expectedCode });
  }
  return payload;
}

function expect(condition, message, details) {
  if (!condition) fail(message, details);
}

const opts = parseArgs(process.argv);

if (!fs.existsSync(opts.cliJs)) {
  fail("cli js not found (build first)", { cliJs: opts.cliJs });
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-smoke-"));
const envBase = {
  SURFWRIGHT_STATE_DIR: stateDir,
  SURFWRIGHT_TEST_BROWSER: "1",
};

let didStartSession = false;
let sessionId = null;
try {
  const doctor = runCliJson(opts, ["doctor"], envBase);
  const doctorPayload = doctor.payload;
  expect(doctorPayload && doctorPayload.ok === true, "doctor returned non-ok", { payload: doctorPayload });
  if (doctorPayload.chrome?.found !== true) {
    if (opts.allowNoBrowser) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          skipped: true,
          reason: "chrome_not_found",
          chrome: doctorPayload.chrome ?? null,
        })}\n`,
      );
      process.exit(0);
    }
    fail("chrome not found (run surfwright --json doctor)", { chrome: doctorPayload.chrome ?? null });
  }

  const ensure = runCliJson(opts, ["session", "ensure", "--timeout-ms", "5000"], envBase);
  const ensurePayload = expectOk("session.ensure", ensure);
  sessionId = ensurePayload.sessionId;
  didStartSession = true;

  // Core deterministic surface page: buttons, links, form controls, upload, and iframe.
  const smokeHtml = `<!doctype html>
<html>
  <head><title>Smoke Tour</title></head>
  <body>
    <main>
      <h1>Smoke</h1>
      <a href="#top" id="link1">Top</a>
      <button id="b1" aria-controls="panel">Open</button>
      <div id="panel" hidden>Panel</div>

      <form id="f">
        <label>Email <input id="email" name="email" type="email" value="" /></label>
        <label><input id="agree" name="agree" type="checkbox" /> Agree</label>
        <input id="submit" type="submit" value="Send" />
      </form>

      <input id="upload" type="file" />

      <iframe id="child" srcdoc="<!doctype html><title>Child</title><button id='cb'>ChildBtn</button>"></iframe>
    </main>
    <script>
      document.getElementById("b1").addEventListener("click", () => {
        const p = document.getElementById("panel");
        p.hidden = !p.hidden;
        document.getElementById("b1").setAttribute("aria-expanded", String(!p.hidden));
      });
      document.getElementById("f").addEventListener("submit", (e) => {
        e.preventDefault();
        document.body.setAttribute("data-submitted", "1");
      });
    </script>
  </body>
</html>`;

  const open = runCliJson(opts, ["--session", sessionId, "open", dataUrl(smokeHtml), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openPayload = expectOk("open(smoke)", open);
  const targetId = openPayload.targetId;
  expect(typeof targetId === "string" && targetId.length > 0, "open did not return targetId", { openPayload });

  const snap = runCliJson(
    opts,
    [
      "--session",
      sessionId,
      "target",
      "snapshot",
      targetId,
      "--include-selector-hints",
      "--frame-scope",
      "all",
      "--max-chars",
      "0",
      "--max-headings",
      "10",
      "--max-buttons",
      "10",
      "--max-links",
      "10",
      "--timeout-ms",
      String(opts.timeoutMs),
    ],
    envBase,
  );
  const snapPayload = expectOk("target.snapshot(smoke)", snap, { targetId });
  expect(Array.isArray(snapPayload.headings), "snapshot.headings not array", { snapPayload });
  expect(Array.isArray(snapPayload.buttons), "snapshot.buttons not array", { snapPayload });
  expect(Array.isArray(snapPayload.links), "snapshot.links not array", { snapPayload });
  expect(snapPayload.headings.length >= 1, "snapshot.headings too small", { snapPayload });
  expect(snapPayload.buttons.length >= 2, "snapshot.buttons missing expected controls", { snapPayload });
  expect(snapPayload.links.length >= 1, "snapshot.links missing expected link", { snapPayload });

  const frames = runCliJson(opts, ["--session", sessionId, "target", "frames", targetId, "--limit", "10", "--timeout-ms", "5000"], envBase);
  const framesPayload = expectOk("target.frames(smoke)", frames, { targetId });
  expect(framesPayload.count >= 2, "expected iframe frameCount >= 2", { framesPayload });

  const evalMain = runCliJson(opts, ["--session", sessionId, "target", "eval", targetId, "--expr", "document.title", "--timeout-ms", "5000"], envBase);
  const evalMainPayload = expectOk("target.eval(main)", evalMain, { targetId });
  expect(evalMainPayload.result?.value === "Smoke Tour", "unexpected eval(main) result", { evalMainPayload });

  const childFrameId = (framesPayload.frames ?? []).find((f) => f && f.frameId && f.frameId !== "f-0")?.frameId ?? null;
  expect(typeof childFrameId === "string" && childFrameId.length > 0, "expected child frame handle", { framesPayload });
  const evalChild = runCliJson(
    opts,
    ["--session", sessionId, "target", "eval", targetId, "--frame-id", childFrameId, "--expr", "document.title", "--timeout-ms", "5000"],
    envBase,
  );
  const evalChildPayload = expectOk("target.eval(child)", evalChild, { targetId, childFrameId });
  expect(evalChildPayload.result?.value === "Child", "unexpected eval(child) result", { evalChildPayload });

  const findButton = runCliJson(opts, ["--session", sessionId, "target", "find", targetId, "--selector", "button", "--limit", "10", "--timeout-ms", "5000"], envBase);
  const findButtonPayload = expectOk("target.find(button)", findButton, { targetId });
  expect(findButtonPayload.count >= 1, "expected at least one <button>", { findButtonPayload });

  const clickDelta = runCliJson(
    opts,
    ["--session", sessionId, "target", "click", targetId, "--selector", "#b1", "--delta", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  const clickDeltaPayload = expectOk("target.click(--delta)", clickDelta, { targetId });
  expect(typeof clickDeltaPayload.delta === "object" && clickDeltaPayload.delta !== null, "click delta missing", { clickDeltaPayload });

  const fill = runCliJson(
    opts,
    ["--session", sessionId, "target", "fill", targetId, "--selector", "#email", "--value", "a@b.com", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  expectOk("target.fill(email)", fill, { targetId });

  const formFill = runCliJson(
    opts,
    [
      "--session",
      sessionId,
      "target",
      "form-fill",
      targetId,
      "--field",
      "#email=hello@example.com",
      "--field",
      "#agree=true",
      "--timeout-ms",
      String(opts.timeoutMs),
    ],
    envBase,
  );
  expectOk("target.form-fill", formFill, { targetId });

  const keypress = runCliJson(opts, ["--session", sessionId, "target", "keypress", targetId, "--key", "Enter", "--selector", "#email", "--timeout-ms", String(opts.timeoutMs)], envBase);
  expectOk("target.keypress", keypress, { targetId });

  const uploadPath = path.join(stateDir, "upload.txt");
  fs.writeFileSync(uploadPath, "hello\n", "utf8");
  const upload = runCliJson(
    opts,
    ["--session", sessionId, "target", "upload", targetId, "--selector", "#upload", "--file", uploadPath, "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  expectOk("target.upload", upload, { targetId });

  // Multi-match click: --explain should succeed and --index should pick the second visible match.
  const multiHtml = `<!doctype html>
<title>Index</title>
<main>
  <button class="danger">Delete</button>
  <button class="danger">Delete</button>
  <button class="danger" style="display:none">Delete</button>
</main>`;
  const openMulti = runCliJson(opts, ["--session", sessionId, "open", dataUrl(multiHtml), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openMultiPayload = expectOk("open(multi)", openMulti);
  const multiTargetId = openMultiPayload.targetId;
  const explain = runCliJson(
    opts,
    ["--session", sessionId, "target", "click", multiTargetId, "--text", "Delete", "--visible-only", "--explain", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  expectOk("target.click(--explain)", explain, { multiTargetId });
  const indexClick = runCliJson(
    opts,
    ["--session", sessionId, "target", "click", multiTargetId, "--text", "Delete", "--visible-only", "--index", "1", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  const indexClickPayload = expectOk("target.click(--index)", indexClick, { multiTargetId });
  expect(indexClickPayload.pickedIndex === 1, "target.click --index did not pick expected element", { indexClickPayload });

  // Dialog accept.
  const dialogHtml = `<!doctype html>
<title>Dialog</title>
<main>
  <button id="d">Dialog</button>
  <script>
    document.getElementById('d').addEventListener('click', () => alert('hi'));
  </script>
</main>`;
  const openDialog = runCliJson(opts, ["--session", sessionId, "open", dataUrl(dialogHtml), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openDialogPayload = expectOk("open(dialog)", openDialog);
  const dialogTargetId = openDialogPayload.targetId;
  const dialog = runCliJson(
    opts,
    ["--session", sessionId, "target", "dialog", dialogTargetId, "--action", "accept", "--trigger-selector", "#d", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  expectOk("target.dialog(accept)", dialog, { dialogTargetId });

  // Read chunking.
  let readBody = "<!doctype html><title>Read</title><main>";
  for (let i = 1; i <= 200; i += 1) readBody += `Line ${i}<br/>`;
  readBody += "</main>";
  const openRead = runCliJson(opts, ["--session", sessionId, "open", dataUrl(readBody), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openReadPayload = expectOk("open(read)", openRead);
  const readTargetId = openReadPayload.targetId;
  const read1 = runCliJson(opts, ["--session", sessionId, "target", "read", readTargetId, "--selector", "main", "--chunk-size", "200", "--chunk", "1", "--timeout-ms", String(opts.timeoutMs)], envBase);
  expectOk("target.read(chunk1)", read1, { readTargetId });
  const read2 = runCliJson(opts, ["--session", sessionId, "target", "read", readTargetId, "--selector", "main", "--chunk-size", "200", "--chunk", "2", "--timeout-ms", String(opts.timeoutMs)], envBase);
  expectOk("target.read(chunk2)", read2, { readTargetId });

  // Typed failure sanity: unserializable eval should map to E_EVAL_RESULT_UNSERIALIZABLE.
  const evalErrHtml = `<!doctype html><title>EvalErr</title><main><button id="b">B</button></main>`;
  const openEvalErr = runCliJson(opts, ["--session", sessionId, "open", dataUrl(evalErrHtml), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openEvalErrPayload = expectOk("open(evalErr)", openEvalErr);
  const evalErrTargetId = openEvalErrPayload.targetId;
  const badEval = runCliJson(opts, ["--session", sessionId, "target", "eval", evalErrTargetId, "--expr", "(() => ({x: window}))()", "--timeout-ms", "5000"], envBase);
  expectTypedFailure("target.eval(unserializable)", badEval, "E_EVAL_RESULT_UNSERIALIZABLE");
  const afterBad = runCliJson(opts, ["--session", sessionId, "target", "snapshot", evalErrTargetId, "--max-chars", "0", "--max-headings", "5", "--max-buttons", "5", "--max-links", "5", "--timeout-ms", String(opts.timeoutMs)], envBase);
  expectOk("target.snapshot(after bad eval)", afterBad, { evalErrTargetId });

  // Streaming tails should end with capture end when run with global --json.
  const openExample = runCliJson(opts, ["--session", sessionId, "open", "https://example.com", "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openExamplePayload = expectOk("open(example.com)", openExample);
  const exampleTargetId = openExamplePayload.targetId;
  const netTail = runCliNdjson(
    opts,
    ["--session", sessionId, "target", "network-tail", exampleTargetId, "--profile", "perf", "--capture-ms", "1200", "--max-events", "80", "--reload", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  const lastNet = netTail.events[netTail.events.length - 1] ?? null;
  expect(lastNet && lastNet.type === "capture" && lastNet.phase === "end", "network-tail did not end with capture end", { lastNet });

  const consoleHtml = `<!doctype html><title>Console</title><script>console.log('hello'); console.warn('warn'); console.error('err');</script>`;
  const openConsole = runCliJson(opts, ["--session", sessionId, "open", dataUrl(consoleHtml), "--timeout-ms", String(opts.timeoutMs)], envBase);
  const openConsolePayload = expectOk("open(console)", openConsole);
  const consoleTargetId = openConsolePayload.targetId;
  const consoleTail = runCliNdjson(
    opts,
    ["--session", sessionId, "target", "console-tail", consoleTargetId, "--capture-ms", "800", "--max-events", "30", "--levels", "error,warn,log", "--reload", "--timeout-ms", String(opts.timeoutMs)],
    envBase,
  );
  const lastConsole = consoleTail.events[consoleTail.events.length - 1] ?? null;
  expect(lastConsole && lastConsole.type === "capture" && lastConsole.phase === "end", "console-tail did not end with capture end", { lastConsole });

  // Optional live probe (networked UX sanity).
  if (opts.live) {
    const openLive = runCliJson(
      opts,
      ["--session", sessionId, "open", "https://getbootstrap.com/docs/5.3/components/modal/", "--timeout-ms", String(opts.timeoutMs)],
      envBase,
    );
    const openLivePayload = expectOk("open(bootstrap)", openLive);
    const liveTargetId = openLivePayload.targetId;
    const liveClick = runCliJson(
      opts,
      [
        "--session",
        sessionId,
        "target",
        "click",
        liveTargetId,
        "--text",
        "Launch demo modal",
        "--visible-only",
        "--wait-for-selector",
        "[aria-modal=\"true\"]",
        "--delta",
        "--timeout-ms",
        String(opts.timeoutMs),
      ],
      envBase,
    );
    expectOk("target.click(bootstrap modal)", liveClick, { liveTargetId });
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      stateDir,
      sessionId,
      live: opts.live,
    })}\n`,
  );
} finally {
  if (didStartSession) {
    // Best-effort cleanup; never fail the run due to cleanup.
    try {
      spawnSync(process.execPath, [opts.cliJs, "--json", "session", "clear"], {
        encoding: "utf8",
        env: { ...process.env, ...envBase },
        cwd: process.cwd(),
      });
    } catch {
      // ignore
    }
  }
  try {
    fs.rmSync(stateDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

