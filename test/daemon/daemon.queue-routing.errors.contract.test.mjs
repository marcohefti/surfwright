import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const DAEMON_META_VERSION = 1;
const DAEMON_QUEUE_RETRY_MAX_ATTEMPTS = 2;

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

async function runCli(args, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new Error(`CLI terminated by signal ${signal}`));
        return;
      }
      resolve({
        status: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function daemonMetaPath(stateDir) {
  return path.join(stateDir, "daemon.json");
}

function writeDaemonMeta(stateDir, opts) {
  fs.mkdirSync(stateDir, { recursive: true });
  const metaPath = daemonMetaPath(stateDir);
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({
      version: DAEMON_META_VERSION,
      pid: opts.pid,
      host: "127.0.0.1",
      port: opts.port,
      token: opts.token,
      startedAt: new Date().toISOString(),
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (process.platform !== "win32") {
    fs.chmodSync(metaPath, 0o600);
  }
}

async function withStubDaemon(response, run) {
  const requests = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      requests.push(line);
      const payload = typeof response === "function" ? response() : response;
      socket.end(`${JSON.stringify(payload)}\n`);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    await run({ port, requests });
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

test("daemon client rejects oversized daemon response frames and falls back locally", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-oversized-response-"));
  const token = "oversized-response-token";
  const oversizedMessage = "x".repeat(1024 * 1024 * 4 + 1024);

  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_RUN_FAILED",
        message: oversizedMessage,
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["session", "list"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(requests.length, 1);
        assert.equal(fs.existsSync(daemonMetaPath(stateDir)), false);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("queue errors never collapse to E_DAEMON_RUN_FAILED at CLI surface", async () => {
  const runCase = async (code) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `surfwright-daemon-queue-shape-${code}-`));
    const token = `shape-token-${code}`;
    try {
      await withStubDaemon(
        {
          ok: false,
          code,
          message: `typed queue code ${code}`,
        },
        async ({ port, requests }) => {
          writeDaemonMeta(stateDir, { pid: process.pid, port, token });
          const result = await runCli(["session", "list"], {
            SURFWRIGHT_STATE_DIR: stateDir,
            SURFWRIGHT_DAEMON: "1",
          });
          assert.equal(result.status, 1);
          const payload = parseJson(result.stdout);
          assert.equal(payload.code, code);
          assert.notEqual(payload.code, "E_DAEMON_RUN_FAILED");
          assert.equal(requests.length, DAEMON_QUEUE_RETRY_MAX_ATTEMPTS + 1);
        },
      );
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  };

  await runCase("E_DAEMON_QUEUE_TIMEOUT");
  await runCase("E_DAEMON_QUEUE_SATURATED");
});

test("daemon preserves typed CLI validation failures instead of E_DAEMON_RUN_FAILED", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-typed-cli-failure-"));
  try {
    const result = await runCli(["target", "attr", "t-1", "--selector", "input", "--nth", "0", "--name", "checked"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
      SURFWRIGHT_DAEMON_IDLE_MS: "300",
    });
    assert.equal(result.status, 1);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "E_QUERY_INVALID");
    assert.notEqual(payload.code, "E_DAEMON_RUN_FAILED");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
