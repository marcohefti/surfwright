#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerTargetCommands } from "./cli-target.js";
import { toCliFailure } from "./core/errors.js";
import { type CliFailure } from "./core/types.js";
import { parseWorkerArgv, runTargetNetworkWorker } from "./features/network/index.js";
import { registerRuntimeCommands } from "./features/runtime/register-commands.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

function resolveRepoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..");
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(resolveRepoRoot(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function jsonSpacing(pretty: boolean): number {
  return pretty ? 2 : 0;
}

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, jsonSpacing(opts.pretty))}\n`);
}

function printFailure(failure: CliFailure, opts: OutputOpts) {
  if (opts.json) {
    writeJson(failure, { pretty: opts.pretty });
    return;
  }
  process.stdout.write(`error ${failure.code}: ${failure.message}\n`);
}

function parseTimeoutMs(input: string): number {
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("timeout-ms must be a positive integer");
  }
  return value;
}

function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  return out;
}

async function maybeRunInternalWorker(): Promise<boolean> {
  if (process.argv[2] !== "__network-worker") {
    return false;
  }
  try {
    const workerOpts = parseWorkerArgv(process.argv.slice(3));
    await runTargetNetworkWorker(workerOpts);
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  }
  return true;
}

const program = new Command();

function globalOutputOpts(): OutputOpts {
  const globalOpts = program.opts<{ json?: boolean; pretty?: boolean }>();
  return {
    json: Boolean(globalOpts.json),
    pretty: Boolean(globalOpts.pretty),
  };
}

function handleFailure(error: unknown, opts: OutputOpts) {
  printFailure(toCliFailure(error), opts);
  process.exitCode = 1;
}

program
  .name("surfwright")
  .description(
    [
      "Agent-first browser control surface for Chrome/Chromium.",
      "Low-noise, composable commands. Deterministic output. JSON-first ergonomics.",
    ].join(" "),
  )
  .version(readPackageVersion(), "-v, --version")
  .option("--json", "Machine-readable output (where supported)", false)
  .option("--pretty", "Pretty-print JSON output", false)
  .option("--session <sessionId>", "Use a specific session for this command");

const ranWorker = await maybeRunInternalWorker();
if (!ranWorker) {
  registerRuntimeCommands({
    program,
    parseTimeoutMs,
    globalOutputOpts,
    handleFailure,
    readPackageVersion,
  });

  registerTargetCommands({
    program,
    parseTimeoutMs,
    globalOutputOpts,
    handleFailure,
  });

  program.parse(normalizeArgv(process.argv));
}
