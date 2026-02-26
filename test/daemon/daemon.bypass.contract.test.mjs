import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const DAEMON_META_VERSION = 1;

async function runCli(args, env = {}, input = "") {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
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
    if (input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
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
      socket.end(`${JSON.stringify(response)}\n`);
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
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function writeDaemonMeta(stateDir, opts) {
  const metaPath = path.join(stateDir, "daemon.json");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({
      version: DAEMON_META_VERSION,
      pid: process.pid,
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

test("streaming commands bypass daemon proxy path", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-bypass-stream-"));
  const token = "bypass-stream-token";
  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_RUN_FAILED",
        message: "daemon should not receive streaming command",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { port, token });
        const result = await runCli(["target", "network-tail", "DEADBEEF", "--session", "s-missing"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(result.status, 1);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("non-streaming bypass classes stay direct (skill + run --plan -)", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-daemon-bypass-nonstream-"));
  const token = "bypass-nonstream-token";
  try {
    await withStubDaemon(
      {
        ok: false,
        code: "E_DAEMON_RUN_FAILED",
        message: "daemon should not receive bypass-class command",
      },
      async ({ port, requests }) => {
        writeDaemonMeta(stateDir, { port, token });

        const skillResult = await runCli(["skill", "doctor"], {
          SURFWRIGHT_STATE_DIR: stateDir,
          SURFWRIGHT_DAEMON: "1",
        });
        assert.equal(skillResult.status, 0);

        const planResult = await runCli(
          ["run", "--plan", "-", "--doctor"],
          {
            SURFWRIGHT_STATE_DIR: stateDir,
            SURFWRIGHT_DAEMON: "1",
          },
          "{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"}]}",
        );
        assert.equal(planResult.status, 0);
        assert.equal(requests.length, 0);
      },
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
