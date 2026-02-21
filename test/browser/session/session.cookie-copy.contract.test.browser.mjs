import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-cookie-copy-");
const { runCliSync, runCliAsync } = createCliRunner({ stateDir: TEST_STATE_DIR });

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
  const result = runCli(["doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
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

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

test("session cookie-copy transfers scoped cookies between explicit sessions", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Cookie Copy Host</title><main>cookie copy</main>");
  }, async (baseUrl) => {
    const sourceSessionId = `s-cookie-src-${Date.now()}`;
    const destinationSessionId = `s-cookie-dst-${Date.now()}`;

    const sourceSessionResult = await runCliAsync(["session",
      "new",
      "--session-id",
      sourceSessionId,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(sourceSessionResult.status, 0);

    const destinationSessionResult = await runCliAsync(["session",
      "new",
      "--session-id",
      destinationSessionId,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(destinationSessionResult.status, 0);

    const sourceOpenResult = await runCliAsync(["--session",
      sourceSessionId,
      "open",
      baseUrl,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(sourceOpenResult.status, 0);
    const sourceOpenPayload = parseJson(sourceOpenResult.stdout);

    const setCookiesResult = await runCliAsync(["--session",
      sourceSessionId,
      "target",
      "eval",
      sourceOpenPayload.targetId,
      "--expr",
      "(() => { document.cookie='sw_cookie_copy_a=alpha; path=/'; document.cookie='sw_cookie_copy_b=beta; path=/'; return document.cookie; })()",
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(setCookiesResult.status, 0);

    const copyResult = await runCliAsync(["session",
      "cookie-copy",
      "--from-session",
      sourceSessionId,
      "--to-session",
      destinationSessionId,
      "--url",
      baseUrl,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(copyResult.status, 0);
    const copyPayload = parseJson(copyResult.stdout);
    assert.deepEqual(Object.keys(copyPayload), [
      "ok",
      "fromSessionId",
      "toSessionId",
      "urls",
      "counts",
      "sample",
      "timingMs",
    ]);
    assert.equal(copyPayload.ok, true);
    assert.equal(copyPayload.fromSessionId, sourceSessionId);
    assert.equal(copyPayload.toSessionId, destinationSessionId);
    assert.equal(copyPayload.urls.includes(new URL(baseUrl).toString()), true);
    assert.equal(copyPayload.counts.imported >= 2, true);
    assert.equal(copyPayload.sample.cookieNames.includes("sw_cookie_copy_a"), true);
    assert.equal(copyPayload.sample.cookieNames.includes("sw_cookie_copy_b"), true);

    const destinationOpenResult = await runCliAsync(["--session",
      destinationSessionId,
      "open",
      baseUrl,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(destinationOpenResult.status, 0);
    const destinationOpenPayload = parseJson(destinationOpenResult.stdout);

    const readCookiesResult = await runCliAsync(["--session",
      destinationSessionId,
      "target",
      "eval",
      destinationOpenPayload.targetId,
      "--expr",
      "document.cookie",
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(readCookiesResult.status, 0);
    const readCookiesPayload = parseJson(readCookiesResult.stdout);
    assert.equal(typeof readCookiesPayload.result?.value, "string");
    assert.equal(readCookiesPayload.result.value.includes("sw_cookie_copy_a=alpha"), true);
    assert.equal(readCookiesPayload.result.value.includes("sw_cookie_copy_b=beta"), true);
  });
});
