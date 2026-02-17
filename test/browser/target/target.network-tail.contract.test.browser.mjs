import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-network-tail-contract-");
const { runCliSync, runCliAsync } = createCliRunner({ stateDir: TEST_STATE_DIR });

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }

  const result = runCliSync(["--json", "doctor"]);
  if (result.status !== 0) {
    hasBrowserCache = false;
    return hasBrowserCache;
  }
  const payload = parseJson(result.stdout);
  hasBrowserCache = payload?.chrome?.found === true;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright --json doctor`)");
}

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  const baseUrl = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to read local test server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

test("target network-tail --failed-only emits only failed request events", async () => {
  requireBrowser();

  await withHttpServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <meta charset="utf-8">
        <title>Network Tail</title>
        <script src="/ok.js"></script>
        <script src="/fail.js"></script>`);
      return;
    }
    if (req.url === "/ok.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      res.end("window.__ok = 1;");
      return;
    }
    if (req.url === "/fail.js") {
      // Force a network failure (loadingFailed) without reaching out to the internet.
      req.socket.destroy();
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const ensureResult = await runCliAsync(["--json", "session", "ensure", "--timeout-ms", "6000"]);
    assert.equal(ensureResult.status, 0, ensureResult.stdout || ensureResult.stderr);
    const ensurePayload = parseJson(ensureResult.stdout);

    const openResult = await runCliAsync(["--json", "--session", ensurePayload.sessionId, "open", baseUrl, "--timeout-ms", "20000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);

    const tail = await runCliAsync([
      "--json",
      "--session",
      ensurePayload.sessionId,
      "target",
      "network-tail",
      openPayload.targetId,
      "--capture-ms",
      "4000",
      "--max-events",
      "50",
      "--failed-only",
      "--reload",
      "--timeout-ms",
      "20000",
    ]);
    assert.equal(tail.status, 0, tail.stdout || tail.stderr);

    const lines = tail.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.equal(lines.length > 0, true);
    const events = lines.map((line) => JSON.parse(line));

    assert.equal(events.some((e) => e?.type === "capture" && e?.phase === "end"), true);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "failed"), true);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "start"), false);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "end"), false);
  });
});
