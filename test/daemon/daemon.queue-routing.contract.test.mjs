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

function readNdjson(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
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
      const parsed = line.length > 0 ? JSON.parse(line) : null;
      const payload = typeof response === "function" ? response(parsed) : response;
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

async function reserveUnusedLocalPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(() => resolve()));
  return port;
}

test("CLI surfaces E_DAEMON_QUEUE_TIMEOUT directly from daemon typed failure", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-queue-timeout-"));
  const token = "timeout-token";

  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_QUEUE_TIMEOUT",
        message: "Daemon queue wait budget expired before dispatch",
        retryable: true,
        phase: "daemon_queue",
        recovery: {
          strategy: "retry-after-backoff",
          nextCommand: "surfwright <same-command>",
          requiredFields: ["queueScope", "retryAfterMs"],
          context: {
            queueScope: "session:s-default",
            retryAfterMs: 60,
          },
        },
        hints: ["Retry the same command after a short backoff"],
        hintContext: {
          queueScope: "session:s-default",
          daemonQueueRetryAttempts: 2,
        },
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["session", "list"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 1);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, false);
        assert.equal(payload.code, "E_DAEMON_QUEUE_TIMEOUT");
        assert.equal(payload.retryable, true);
        assert.equal(payload.phase, "daemon_queue");
        assert.equal(payload.recovery?.strategy, "retry-after-backoff");
        assert.equal(payload.hintContext?.queueScope, "session:s-default");
        assert.equal(requests.length, DAEMON_QUEUE_RETRY_MAX_ATTEMPTS + 1);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("CLI surfaces E_DAEMON_QUEUE_SATURATED directly from daemon typed failure", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-queue-saturated-"));
  const token = "saturated-token";

  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_QUEUE_SATURATED",
        message: "daemon lane queue depth exceeded",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["session", "list"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 1);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, false);
        assert.equal(payload.code, "E_DAEMON_QUEUE_SATURATED");
        assert.equal(requests.length, DAEMON_QUEUE_RETRY_MAX_ATTEMPTS + 1);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon-unreachable path falls back to local CLI execution", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-unreachable-"));
  const token = "unreachable-token";

  try {
    const unusedPort = await reserveUnusedLocalPort();
    writeDaemonMeta(stateDir, { pid: process.pid, port: unusedPort, token });

    const result = await runCli(["session", "list"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
    });

    assert.equal(result.status, 0);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(fs.existsSync(daemonMetaPath(stateDir)), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("CLI retries queue overload once daemon recovers and returns success", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-queue-retry-recover-"));
  const token = "queue-retry-recover-token";
  let remainingQueueFailures = 1;

  try {
    await withStubDaemon(
      () => {
        if (remainingQueueFailures > 0) {
          remainingQueueFailures -= 1;
          return {
            ok: false,
            code: "E_DAEMON_QUEUE_TIMEOUT",
            message: "daemon queue wait budget exceeded",
          };
        }
        return {
          ok: true,
          kind: "run",
          code: 0,
          stdout: '{"ok":true}\n',
          stderr: "",
        };
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
        assert.equal(requests.length, 2);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon-unreachable fallback is recorded in debug diagnostics events", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-unreachable-diag-"));
  const token = "unreachable-diag-token";
  const eventsPath = path.join(stateDir, "diagnostics", "daemon.ndjson");

  try {
    const unusedPort = await reserveUnusedLocalPort();
    writeDaemonMeta(stateDir, { pid: process.pid, port: unusedPort, token });

    const result = await runCli(["session", "list"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "1",
      SURFWRIGHT_DEBUG_LOGS: "1",
    });

    assert.equal(result.status, 0);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, true);

    const events = readNdjson(eventsPath);
    assert.equal(events.length > 0, true);
    const fallbackEvent = events.find((entry) => entry.event === "daemon_cli_fallback");
    assert.notEqual(fallbackEvent, undefined);
    assert.equal(fallbackEvent.result, "unreachable");
    assert.equal(fallbackEvent.command, "session list");
    assert.equal(typeof fallbackEvent.fallbackMessage, "string");
    assert.equal(fallbackEvent.fallbackMessage.length > 0, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("contract commands bypass daemon proxy even when daemon metadata exists", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-contract-bypass-"));
  const token = "contract-bypass-token";
  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_QUEUE_TIMEOUT",
        message: "contract should not proxy via daemon",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["contract"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon injects request-scoped agent id into argv when --agent-id is absent", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-agentid-inject-"));
  const token = "agentid-inject-token";
  try {
    await withStubDaemon(
      {
        ok: true,
        kind: "run",
        code: 0,
        stdout: '{"ok":true}\n',
        stderr: "",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["open", "https://example.com"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
          SURFWRIGHT_AGENT_ID: "agent.env",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(requests.length, 1);
        const request = JSON.parse(requests[0]);
        assert.equal(request.kind, "run");
        assert.equal(Array.isArray(request.argv), true);
        const argv = request.argv;
        const index = argv.indexOf("--agent-id");
        assert.notEqual(index, -1);
        assert.equal(argv[index + 1], "agent.env");
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("daemon keeps explicit --agent-id instead of replacing with request-scoped agent id", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-agentid-explicit-"));
  const token = "agentid-explicit-token";
  try {
    await withStubDaemon(
      {
        ok: true,
        kind: "run",
        code: 0,
        stdout: '{"ok":true}\n',
        stderr: "",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["--agent-id", "agent.cli", "open", "https://example.com"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
          SURFWRIGHT_AGENT_ID: "agent.env",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(requests.length, 1);
        const request = JSON.parse(requests[0]);
        const argv = request.argv;
        const indexes = argv
          .map((tokenValue, index) => ({ tokenValue, index }))
          .filter((entry) => entry.tokenValue === "--agent-id")
          .map((entry) => entry.index);
        assert.equal(indexes.length, 1);
        assert.equal(argv[indexes[0] + 1], "agent.cli");
        assert.equal(argv.includes("agent.env"), false);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("hard-off daemon mode never spawns daemon metadata", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-hardoff-nospawn-"));

  try {
    const result = await runCli(["session", "list"], {
      SURFWRIGHT_STATE_DIR: stateDir,
      SURFWRIGHT_DAEMON: "0",
    });
    assert.equal(result.status, 0);
    const payload = parseJson(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(fs.existsSync(daemonMetaPath(stateDir)), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("hard-off daemon mode never proxies to existing daemon metadata", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-hardoff-noproxy-"));
  const token = "hardoff-token";

  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_QUEUE_TIMEOUT",
        message: "should never be observed when hard-off is enabled",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["session", "list"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "0",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("contract command bypasses daemon proxy even when daemon metadata exists", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-contract-bypass-"));
  const token = "contract-bypass-token";
  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_QUEUE_TIMEOUT",
        message: "contract should not proxy via daemon",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { pid: process.pid, port, token });
        const result = await runCli(["contract"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 0);
        const payload = parseJson(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(Array.isArray(payload.commandIds), true);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
