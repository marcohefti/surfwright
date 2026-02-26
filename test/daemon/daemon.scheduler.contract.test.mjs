import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runNodeModule(code) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { encoding: "utf8", cwd: process.cwd() },
  );
}

function parseJsonLine(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON on stdout");
  return JSON.parse(text);
}

function spansOverlap(left, right) {
  return Math.min(left.end, right.end) > Math.max(left.start, right.start);
}

test("daemon worker serializes same-session requests across processes", () => {
  const result = runNodeModule(`
    import net from "node:net";
    import { spawn } from "node:child_process";
    import { runDaemonWorker } from "./src/core/daemon/infra/worker.ts";

    const port = 43000 + Math.floor(Math.random() * 1000);
    const token = "daemon-test-token";
    const marks = [];
    const responseById = new Map();

    const workerPromise = runDaemonWorker({
      port,
      token,
      onRun: async (argv, lane) => {
        const id = argv[argv.length - 1];
        marks.push({ type: "start", id, lane: lane.laneKey, t: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 80));
        marks.push({ type: "end", id, lane: lane.laneKey, t: Date.now() });
        responseById.set(id, { laneKey: lane.laneKey });
        return { code: 0, stdout: id, stderr: "" };
      },
    });

    function sendRaw(payload) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          const newlineIndex = buffer.indexOf("\\n");
          if (newlineIndex === -1) {
            return;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          socket.end();
          resolve(JSON.parse(line));
        });
        socket.on("connect", () => {
          socket.write(JSON.stringify(payload) + "\\n");
        });
        socket.on("error", reject);
      });
    }

    async function waitUntilReady() {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          await sendRaw({ token, kind: "ping" });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      throw new Error("worker did not start listening");
    }

    async function spawnClient(argv) {
      const script = \`
        import net from "node:net";
        const port = Number(process.env.PORT);
        const token = String(process.env.TOKEN || "");
        const argv = JSON.parse(String(process.env.ARGV_JSON || "[]"));
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          const newlineIndex = buffer.indexOf("\\\\n");
          if (newlineIndex === -1) {
            return;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          process.stdout.write(line);
          socket.end();
        });
        socket.on("connect", () => {
          socket.write(JSON.stringify({ token, kind: "run", argv }) + "\\\\n");
        });
        socket.on("error", (error) => {
          process.stderr.write(String(error));
          process.exit(1);
        });
      \`;

      return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
          env: {
            ...process.env,
            PORT: String(port),
            TOKEN: token,
            ARGV_JSON: JSON.stringify(argv),
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
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error("client exited with code " + String(code) + ": " + stderr));
            return;
          }
          resolve(JSON.parse(stdout.trim()));
        });
      });
    }

    await waitUntilReady();
    const first = spawnClient(["node", "dist/cli.js", "contract", "--session", "s-1", "req-1"]);
    const second = spawnClient(["node", "dist/cli.js", "contract", "--session", "s-1", "req-2"]);
    const responses = await Promise.all([first, second]);

    await sendRaw({ token, kind: "shutdown" });
    await workerPromise;

    console.log(JSON.stringify({ marks, responses, responseById: Object.fromEntries(responseById.entries()) }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  const req1Start = payload.marks.find((mark) => mark.type === "start" && mark.id === "req-1");
  const req1End = payload.marks.find((mark) => mark.type === "end" && mark.id === "req-1");
  const req2Start = payload.marks.find((mark) => mark.type === "start" && mark.id === "req-2");
  const req2End = payload.marks.find((mark) => mark.type === "end" && mark.id === "req-2");

  assert.ok(req1Start && req1End && req2Start && req2End, "Expected timing markers for req-1 and req-2");
  assert.equal(spansOverlap({ start: req1Start.t, end: req1End.t }, { start: req2Start.t, end: req2End.t }), false);
  assert.equal(payload.responses.length, 2);
  assert.equal(payload.responseById["req-1"].laneKey, "session:s-1");
  assert.equal(payload.responseById["req-2"].laneKey, "session:s-1");
  assert.equal(payload.responses.every((response) => response.ok === true), true);
});

test("daemon worker keeps independent sessions from blocking each other", () => {
  const result = runNodeModule(`
    import net from "node:net";
    import { spawn } from "node:child_process";
    import { runDaemonWorker } from "./src/core/daemon/infra/worker.ts";

    const port = 44000 + Math.floor(Math.random() * 1000);
    const token = "daemon-test-token";
    const marks = [];
    const workerPromise = runDaemonWorker({
      port,
      token,
      onRun: async (argv, lane) => {
        const id = argv[argv.length - 1];
        marks.push({ type: "start", id, lane: lane.laneKey, t: Date.now() });
        await new Promise((resolve) => setTimeout(resolve, 90));
        marks.push({ type: "end", id, lane: lane.laneKey, t: Date.now() });
        return { code: 0, stdout: id, stderr: "" };
      },
    });

    function sendRaw(payload) {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          const newlineIndex = buffer.indexOf("\\n");
          if (newlineIndex === -1) {
            return;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          socket.end();
          resolve(JSON.parse(line));
        });
        socket.on("connect", () => {
          socket.write(JSON.stringify(payload) + "\\n");
        });
        socket.on("error", reject);
      });
    }

    async function waitUntilReady() {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          await sendRaw({ token, kind: "ping" });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      throw new Error("worker did not start listening");
    }

    async function spawnClient(argv) {
      const script = \`
        import net from "node:net";
        const port = Number(process.env.PORT);
        const token = String(process.env.TOKEN || "");
        const argv = JSON.parse(String(process.env.ARGV_JSON || "[]"));
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          const newlineIndex = buffer.indexOf("\\\\n");
          if (newlineIndex === -1) {
            return;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          process.stdout.write(line);
          socket.end();
        });
        socket.on("connect", () => {
          socket.write(JSON.stringify({ token, kind: "run", argv }) + "\\\\n");
        });
        socket.on("error", (error) => {
          process.stderr.write(String(error));
          process.exit(1);
        });
      \`;

      return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
          env: {
            ...process.env,
            PORT: String(port),
            TOKEN: token,
            ARGV_JSON: JSON.stringify(argv),
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
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error("client exited with code " + String(code) + ": " + stderr));
            return;
          }
          resolve(JSON.parse(stdout.trim()));
        });
      });
    }

    await waitUntilReady();
    const left = spawnClient(["node", "dist/cli.js", "contract", "--session", "session-a", "req-a"]);
    const right = spawnClient(["node", "dist/cli.js", "contract", "--session", "session-b", "req-b"]);
    const responses = await Promise.all([left, right]);

    await sendRaw({ token, kind: "shutdown" });
    await workerPromise;

    console.log(JSON.stringify({ marks, responses }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  const leftStart = payload.marks.find((mark) => mark.type === "start" && mark.id === "req-a");
  const leftEnd = payload.marks.find((mark) => mark.type === "end" && mark.id === "req-a");
  const rightStart = payload.marks.find((mark) => mark.type === "start" && mark.id === "req-b");
  const rightEnd = payload.marks.find((mark) => mark.type === "end" && mark.id === "req-b");

  assert.ok(leftStart && leftEnd && rightStart && rightEnd, "Expected timing markers for req-a and req-b");
  assert.equal(spansOverlap({ start: leftStart.t, end: leftEnd.t }, { start: rightStart.t, end: rightEnd.t }), true);
  assert.equal(payload.responses.every((response) => response.ok === true), true);
});

test("daemon scheduler emits queue-timeout code only on wait-budget expiry", () => {
  const result = runNodeModule(`
    import { createDaemonLaneScheduler } from "./src/core/daemon/domain/lane-scheduler.ts";

    const metrics = [];
    const scheduler = createDaemonLaneScheduler({
      globalActiveLanes: 1,
      laneQueueDepth: 8,
      queueWaitMs: 20,
      diagnostics: {
        emitEvent: () => {},
        emitMetric: (metric) => {
          metrics.push(metric);
        },
      },
    });

    const first = scheduler.enqueue({
      laneKey: "session:s-1",
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return "first";
      },
    });

    try {
      await scheduler.enqueue({
        laneKey: "session:s-1",
        execute: async () => "second",
      });
      console.log(JSON.stringify({ ok: false, reason: "expected-timeout", metrics }));
    } catch (error) {
      console.log(JSON.stringify({ ok: true, code: error?.code ?? null, metrics }));
    } finally {
      await first;
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.code, "E_DAEMON_QUEUE_TIMEOUT");
  assert.equal(payload.metrics.some((entry) => entry.metric === "daemon_queue_depth"), true);
  assert.equal(
    payload.metrics.some(
      (entry) =>
        entry.metric === "daemon_queue_rejects_total" &&
        entry.tags?.reason === "timeout" &&
        entry.tags?.scope === "session:s-1",
    ),
    true,
  );
});

test("daemon scheduler emits queue-saturated code only on depth-cap rejection", () => {
  const result = runNodeModule(`
    import { createDaemonLaneScheduler } from "./src/core/daemon/domain/lane-scheduler.ts";

    const metrics = [];
    const scheduler = createDaemonLaneScheduler({
      globalActiveLanes: 1,
      laneQueueDepth: 1,
      queueWaitMs: 500,
      diagnostics: {
        emitEvent: () => {},
        emitMetric: (metric) => {
          metrics.push(metric);
        },
      },
    });

    const first = scheduler.enqueue({
      laneKey: "session:s-1",
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return "first";
      },
    });

    const second = scheduler.enqueue({
      laneKey: "session:s-1",
      execute: async () => "second",
    });

    try {
      await scheduler.enqueue({
        laneKey: "session:s-1",
        execute: async () => "third",
      });
      console.log(JSON.stringify({ ok: false, reason: "expected-saturation", metrics }));
    } catch (error) {
      await Promise.all([first, second]);
      console.log(JSON.stringify({ ok: true, code: error?.code ?? null, metrics }));
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.code, "E_DAEMON_QUEUE_SATURATED");
  assert.equal(payload.metrics.some((entry) => entry.metric === "daemon_queue_depth"), true);
  assert.equal(
    payload.metrics.some(
      (entry) =>
        entry.metric === "daemon_queue_rejects_total" &&
        entry.tags?.reason === "saturated" &&
        entry.tags?.scope === "session:s-1",
    ),
    true,
  );
});
