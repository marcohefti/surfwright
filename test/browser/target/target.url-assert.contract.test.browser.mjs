import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-url-assert-");
const { runCliSync, runCliAsync } = createCliRunner({ stateDir: TEST_STATE_DIR });
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

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
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
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

test("target url-assert returns deterministic shape and typed failures", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Url Assert</title><main>ok</main>");
  }, async (baseUrl) => {
    const url = `${baseUrl}/`;
    const origin = new URL(url).origin;

    const openResult = await runCliAsync(["--json", "open", url, "--timeout-ms", "20000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);
    const targetId = openPayload.targetId;
    assert.equal(typeof targetId, "string");
    assert.equal(targetId.length > 0, true);

    const assertHostResult = await runCliAsync([
      "--json",
      "target",
      "url-assert",
      targetId,
      "--host",
      "127.0.0.1",
      "--timeout-ms",
      "8000",
    ]);
    assert.equal(assertHostResult.status, 0, assertHostResult.stdout || assertHostResult.stderr);
    const assertHostPayload = parseJson(assertHostResult.stdout);
    assert.equal(assertHostPayload.ok, true);
    assert.equal(assertHostPayload.assert.host, "127.0.0.1");
    assert.equal(assertHostPayload.assert.origin, null);
    assert.equal(assertHostPayload.assert.pathPrefix, null);
    assert.equal(assertHostPayload.assert.urlPrefix, null);
    assert.equal(typeof assertHostPayload.blockType, "string");

    const assertAllResult = await runCliAsync([
      "--json",
      "target",
      "url-assert",
      targetId,
      "--origin",
      `${origin}/`,
      "--path-prefix",
      "/",
      "--url-prefix",
      url,
      "--timeout-ms",
      "8000",
    ]);
    assert.equal(assertAllResult.status, 0, assertAllResult.stdout || assertAllResult.stderr);
    const assertAllPayload = parseJson(assertAllResult.stdout);
    assert.equal(assertAllPayload.ok, true);
    assert.equal(assertAllPayload.url, url);
    assert.equal(assertAllPayload.assert.origin, origin);

    const assertInvalidResult = await runCliAsync([
      "--json",
      "target",
      "url-assert",
      targetId,
      "--host",
      "nope.example",
      "--timeout-ms",
      "8000",
    ]);
    assert.equal(assertInvalidResult.status, 1);
    const assertInvalidPayload = parseJson(assertInvalidResult.stdout);
    assert.equal(assertInvalidPayload.ok, false);
    assert.equal(assertInvalidPayload.code, "E_ASSERT_FAILED");

    const assertMissingResult = await runCliAsync(["--json", "target", "url-assert", targetId, "--timeout-ms", "8000"]);
    assert.equal(assertMissingResult.status, 1);
    const assertMissingPayload = parseJson(assertMissingResult.stdout);
    assert.equal(assertMissingPayload.ok, false);
    assert.equal(assertMissingPayload.code, "E_QUERY_INVALID");
  });
});
