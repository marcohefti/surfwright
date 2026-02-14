import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-cookie-copy-"));

function stateFilePath() {
  return path.join(TEST_STATE_DIR, "state.json");
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env: {
        ...process.env,
        SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
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

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const result = runCli(["--json", "doctor"]);
  const payload = parseJson(result.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
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

test("session cookie-copy transfers scoped cookies between explicit sessions", { skip: !hasBrowser() }, async () => {
  await withHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Cookie Copy Host</title><main>cookie copy</main>");
  }, async (baseUrl) => {
    const sourceSessionId = `s-cookie-src-${Date.now()}`;
    const destinationSessionId = `s-cookie-dst-${Date.now()}`;

    const sourceSessionResult = await runCliAsync([
      "--json",
      "session",
      "new",
      "--session-id",
      sourceSessionId,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(sourceSessionResult.status, 0);

    const destinationSessionResult = await runCliAsync([
      "--json",
      "session",
      "new",
      "--session-id",
      destinationSessionId,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(destinationSessionResult.status, 0);

    const sourceOpenResult = await runCliAsync([
      "--json",
      "--session",
      sourceSessionId,
      "open",
      baseUrl,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(sourceOpenResult.status, 0);
    const sourceOpenPayload = parseJson(sourceOpenResult.stdout);

    const setCookiesResult = await runCliAsync([
      "--json",
      "--session",
      sourceSessionId,
      "target",
      "eval",
      sourceOpenPayload.targetId,
      "--js",
      "document.cookie='sw_cookie_copy_a=alpha; path=/'; document.cookie='sw_cookie_copy_b=beta; path=/'; return document.cookie;",
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(setCookiesResult.status, 0);

    const copyResult = await runCliAsync([
      "--json",
      "session",
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

    const destinationOpenResult = await runCliAsync([
      "--json",
      "--session",
      destinationSessionId,
      "open",
      baseUrl,
      "--timeout-ms",
      "6000",
    ]);
    assert.equal(destinationOpenResult.status, 0);
    const destinationOpenPayload = parseJson(destinationOpenResult.stdout);

    const readCookiesResult = await runCliAsync([
      "--json",
      "--session",
      destinationSessionId,
      "target",
      "eval",
      destinationOpenPayload.targetId,
      "--js",
      "return document.cookie;",
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
