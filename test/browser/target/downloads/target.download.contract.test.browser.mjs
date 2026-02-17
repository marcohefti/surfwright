import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-target-download-"));
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      SURFWRIGHT_TEST_BROWSER: "1",
    },
    ...opts,
  });
}

function runCliAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env: {
        ...process.env,
        SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
        SURFWRIGHT_TEST_BROWSER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
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
    const openResult = await runCliAsync(["--json", "open", baseUrl, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);
    assert.equal(typeof openPayload.targetId, "string");

    const dlResult = await runCliAsync([
      "--json",
      "target",
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
    assert.equal(typeof payload.download, "object");
    assert.equal(payload.download !== null, true);
    assert.equal(payload.download.status, 200);
    assert.equal(fs.existsSync(payload.download.path), true);

    const data = fs.readFileSync(payload.download.path);
    const expectedSha = crypto.createHash("sha256").update(data).digest("hex");
    assert.equal(payload.download.sha256, expectedSha);
    assert.equal(payload.download.size, data.byteLength);
  });
});
