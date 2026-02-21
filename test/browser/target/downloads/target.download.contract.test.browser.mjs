import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-download-");
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
  const doctor = runCli(["doctor"]);
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

test("target download captures deterministic download artifact", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <title>Download Page</title>
        <main>
          <a id="dl" href="/download">Download</a>
        </main>`);
      return;
    }
    if (req.url === "/download") {
      const body = Buffer.from("hello\n", "utf8");
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="sw-target.txt"',
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const outDir = path.join(TEST_STATE_DIR, "artifacts", "downloads");
    const openResult = await runCliAsync(["open", baseUrl, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);
    assert.equal(typeof openPayload.targetId, "string");

    const dlResult = await runCliAsync(["target",
      "download",
      openPayload.targetId,
      "--text",
      "Download",
      "--download-out-dir",
      outDir,
      "--timeout-ms",
      "8000",
    ]);
    assert.equal(dlResult.status, 0, dlResult.stdout || dlResult.stderr);
    const payload = parseJson(dlResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.downloadStarted, true);
    assert.equal(payload.downloadStatus, 200);
    assert.equal(typeof payload.downloadFinalUrl, "string");
    assert.equal(typeof payload.downloadFileName, "string");
    assert.equal(typeof payload.downloadBytes, "number");
    assert.equal(typeof payload.download, "object");
    assert.equal(payload.download !== null, true);
    assert.equal(payload.download.downloadStarted, true);
    assert.equal(typeof payload.sourceUrl, "string");
    assert.equal(typeof payload.download.sourceUrl, "string");
    assert.equal(typeof payload.download.fileName, "string");
    assert.equal(typeof payload.download.bytes, "number");
    assert.equal(typeof payload.download.mime, "string");
    assert.equal(payload.download.status, 200);
    assert.equal(fs.existsSync(payload.download.path), true);

    const data = fs.readFileSync(payload.download.path);
    const expectedSha = crypto.createHash("sha256").update(data).digest("hex");
    assert.equal(payload.download.sha256, expectedSha);
    assert.equal(payload.download.bytes, data.byteLength);
  });
});

test("target download can return deterministic non-started envelope on timeout", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <title>No Download</title>
        <main><a id="go" href="/plain">Open Plain</a></main>`);
      return;
    }
    if (req.url === "/plain") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("plain response");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const openResult = await runCliAsync(["open", baseUrl, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);

    const dlResult = await runCliAsync(["target",
      "download",
      openPayload.targetId,
      "--text",
      "Open Plain",
      "--allow-missing-download-event",
      "--timeout-ms",
      "1000",
    ]);
    assert.equal(dlResult.status, 0, dlResult.stdout || dlResult.stderr);
    const payload = parseJson(dlResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.downloadStarted, false);
    assert.equal(payload.downloadStatus, null);
    assert.equal(payload.downloadFinalUrl, null);
    assert.equal(payload.downloadFileName, null);
    assert.equal(payload.downloadBytes, null);
    assert.equal(payload.download, null);
    assert.equal(typeof payload.failureReason, "string");
    assert.equal(payload.failureReason.includes("download event not observed within timeout"), true);
  });
});

test("target download --fallback-to-fetch captures deterministic artifact when download event is missing", async () => {
  requireBrowser();
  await withHttpServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <title>Fetch Fallback</title>
        <main><a id="plain" href="/plain.txt">Open Plain</a></main>`);
      return;
    }
    if (req.url === "/plain.txt") {
      const body = Buffer.from("fallback-body\n", "utf8");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const openResult = await runCliAsync(["open", baseUrl, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);

    const dlResult = await runCliAsync(["target",
      "download",
      openPayload.targetId,
      "--text",
      "Open Plain",
      "--fallback-to-fetch",
      "--timeout-ms",
      "2000",
    ]);
    assert.equal(dlResult.status, 0, dlResult.stdout || dlResult.stderr);
    const payload = parseJson(dlResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.downloadStarted, true);
    assert.equal(payload.downloadMethod, "fetch-fallback");
    assert.equal(typeof payload.downloadFileName, "string");
    assert.equal(typeof payload.downloadedFilename, "string");
    assert.equal(payload.downloadedFilename, payload.downloadFileName);
    assert.equal(payload.downloadedBytes, payload.downloadBytes);
    assert.equal(typeof payload.downloadBytes, "number");
    assert.equal(payload.downloadBytes > 0, true);
    assert.equal(typeof payload.download.path, "string");
    assert.equal(fs.existsSync(payload.download.path), true);
  });
});
