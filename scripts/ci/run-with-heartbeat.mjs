#!/usr/bin/env node
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
let label = "job";
let intervalMs = 30_000;
let dividerIndex = -1;

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--") {
    dividerIndex = index;
    break;
  }
}

if (dividerIndex < 0) {
  process.stderr.write("run-with-heartbeat: missing command separator '--'\n");
  process.exit(1);
}

for (let index = 0; index < dividerIndex; index += 1) {
  const token = argv[index];
  if (token === "--label") {
    const next = argv[index + 1];
    if (typeof next === "string" && next.length > 0) {
      label = next;
      index += 1;
      continue;
    }
    process.stderr.write("run-with-heartbeat: --label requires a value\n");
    process.exit(1);
  }
  if (token === "--interval-ms") {
    const next = argv[index + 1];
    const parsed = Number.parseInt(String(next ?? ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      intervalMs = parsed;
      index += 1;
      continue;
    }
    process.stderr.write("run-with-heartbeat: --interval-ms must be a positive integer\n");
    process.exit(1);
  }
  process.stderr.write(`run-with-heartbeat: unknown option '${token}'\n`);
  process.exit(1);
}

const command = argv.slice(dividerIndex + 1);
if (command.length === 0) {
  process.stderr.write("run-with-heartbeat: no command provided after '--'\n");
  process.exit(1);
}

const startedAt = Date.now();
process.stdout.write(`[heartbeat] ${label} started\n`);

const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const ticker = setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  process.stdout.write(`[heartbeat] ${label} running (${elapsedSeconds}s)\n`);
}, intervalMs);

function stopTicker() {
  clearInterval(ticker);
}

function forwardSignal(signal) {
  if (child.killed === false) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => {
  forwardSignal("SIGINT");
});
process.on("SIGTERM", () => {
  forwardSignal("SIGTERM");
});
process.on("SIGHUP", () => {
  forwardSignal("SIGHUP");
});

child.on("exit", (code, signal) => {
  stopTicker();
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  if (signal) {
    process.stderr.write(`[heartbeat] ${label} exited via signal ${signal} after ${elapsedSeconds}s\n`);
    process.exit(1);
  }
  const exitCode = typeof code === "number" ? code : 1;
  if (exitCode === 0) {
    process.stdout.write(`[heartbeat] ${label} completed in ${elapsedSeconds}s\n`);
  } else {
    process.stderr.write(`[heartbeat] ${label} failed in ${elapsedSeconds}s (exit=${exitCode})\n`);
  }
  process.exit(exitCode);
});
