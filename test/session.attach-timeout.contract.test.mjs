import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-attach-timeout-"));

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

async function withDelayedCdpServer(delayMs, fn) {
  const server = http.createServer((req, res) => {
    if (req.url === "/json/version") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fake",
          }),
        );
      }, delayMs);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const cdpOrigin = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to read delayed CDP server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  try {
    return await fn(cdpOrigin);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

async function withPathAndQueryCdpServer(fn) {
  const server = http.createServer((req, res) => {
    if (req.url === "/relay/json/version?token=abc123") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fake?token=abc123",
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const cdpInput = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to read custom CDP server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/relay?token=abc123`);
    });
  });

  try {
    return await fn(cdpInput);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("session attach honors timeout window for slower CDP health checks", async () => {
  await withDelayedCdpServer(900, async (cdpOrigin) => {
    const sessionId = `a-slow-${Date.now()}`;
    const attachResult = await runCliAsync([
      "--json",
      "session",
      "attach",
      "--cdp",
      cdpOrigin,
      "--session-id",
      sessionId,
      "--timeout-ms",
      "1500",
    ]);

    assert.equal(attachResult.status, 0);
    const attachPayload = parseJson(attachResult.stdout);
    assert.equal(attachPayload.ok, true);
    assert.equal(attachPayload.sessionId, sessionId);
    assert.equal(attachPayload.kind, "attached");
    assert.equal(attachPayload.active, true);
    assert.equal(attachPayload.created, true);
    assert.equal(attachPayload.restarted, false);

    const useResult = await runCliAsync([
      "--json",
      "session",
      "use",
      sessionId,
      "--timeout-ms",
      "1500",
    ]);

    assert.equal(useResult.status, 0);
    const usePayload = parseJson(useResult.stdout);
    assert.equal(usePayload.ok, true);
    assert.equal(usePayload.sessionId, sessionId);
  });
});

test("session attach returns typed unreachable failure when timeout window is too short", async () => {
  await withDelayedCdpServer(900, async (cdpOrigin) => {
    const result = await runCliAsync([
      "--json",
      "session",
      "attach",
      "--cdp",
      cdpOrigin,
      "--session-id",
      `a-timeout-${Date.now()}`,
      "--timeout-ms",
      "200",
    ]);

    assert.equal(result.status, 1);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "E_CDP_UNREACHABLE");
  });
});

test("session attach resolves CDP discovery URLs with path and query parameters", async () => {
  await withPathAndQueryCdpServer(async (cdpInput) => {
    const sessionId = `a-path-${Date.now()}`;
    const attachResult = await runCliAsync([
      "--json",
      "session",
      "attach",
      "--cdp",
      cdpInput,
      "--session-id",
      sessionId,
      "--timeout-ms",
      "1200",
    ]);

    assert.equal(attachResult.status, 0);
    const attachPayload = parseJson(attachResult.stdout);
    assert.equal(attachPayload.ok, true);
    assert.equal(attachPayload.sessionId, sessionId);
    assert.equal(attachPayload.kind, "attached");
    assert.equal(typeof attachPayload.cdpOrigin, "string");
    assert.equal(attachPayload.cdpOrigin.includes("/relay"), true);
  });
});
