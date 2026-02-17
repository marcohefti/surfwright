import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-network-around-");
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

function requireBrowser() {
  const doctor = runCli(["--json", "doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
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

test("target network-around captures around click and returns combined report", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <title>Network Around</title>
        <main>
          <button id="fetch" onclick="fetch('/api').then(r=>r.text()).then(()=>{document.body.dataset.done='1'})">Fetch</button>
        </main>`);
      return;
    }
    if (req.url === "/api") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const openResult = await runCliAsync(["--json", "open", baseUrl, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);

    const result = await runCliAsync([
      "--json",
      "target",
      "network-around",
      openPayload.targetId,
      "--click-text",
      "Fetch",
      "--view",
      "summary",
      "--profile",
      "api",
      "--max-runtime-ms",
      "4000",
      "--timeout-ms",
      "20000",
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.captureId.startsWith("c-"), true);
    assert.equal(payload.click.ok, true);
    assert.equal(payload.network.ok, true);
    assert.equal(payload.network.view, "summary");
  });
});
