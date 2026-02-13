#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerTargetCommands } from "./cli-target.js";
import { toCliFailure } from "./core/errors.js";
import {
  cleanupOwnedDaemonMeta,
  parseDaemonWorkerArgv,
  runDaemonWorker,
  runViaDaemon,
  type DaemonRunResult,
} from "./core/daemon/index.js";
import { type CliFailure } from "./core/types.js";
import { parseWorkerArgv, runTargetNetworkWorker } from "./features/network/index.js";
import { networkCommandManifest } from "./features/network/manifest.js";
import { registerRuntimeCommands } from "./features/runtime/register-commands.js";
import { runtimeCommandManifest } from "./features/runtime/manifest.js";
import { targetCommandManifest } from "./features/target-core/manifest.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

const INITIAL_AGENT_ID_ENV = typeof process.env.SURFWRIGHT_AGENT_ID === "string" ? process.env.SURFWRIGHT_AGENT_ID : null;

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

function parseOptionTokenSpan(argv: string[], index: number, optionName: string): number {
  const token = argv[index];
  if (token === "--") {
    return 0;
  }
  if (token === optionName) {
    const next = index + 1 < argv.length ? argv[index + 1] : null;
    if (typeof next === "string" && next !== "--" && !next.startsWith("-")) {
      return 2;
    }
    return 1;
  }
  const prefix = `${optionName}=`;
  if (token.startsWith(prefix)) {
    return 1;
  }
  return 0;
}

function parseGlobalOptionValue(
  argv: string[],
  optionName: string,
): { found: boolean; valid: boolean; value: string | null } {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    if (token === optionName) {
      const next = index + 1 < argv.length ? argv[index + 1] : null;
      if (typeof next !== "string" || next === "--" || next.startsWith("-")) {
        return {
          found: true,
          valid: false,
          value: null,
        };
      }
      return {
        found: true,
        valid: true,
        value: next,
      };
    }
    const prefix = `${optionName}=`;
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value.length === 0) {
        return {
          found: true,
          valid: false,
          value: null,
        };
      }
      return {
        found: true,
        valid: true,
        value,
      };
    }
  }
  return {
    found: false,
    valid: false,
    value: null,
  };
}

function applyAgentIdOverrideFromArgv(argv: string[]): void {
  const parsed = parseGlobalOptionValue(argv, "--agent-id");
  if (!parsed.found || !parsed.valid) {
    if (INITIAL_AGENT_ID_ENV === null) {
      delete process.env.SURFWRIGHT_AGENT_ID;
    } else {
      process.env.SURFWRIGHT_AGENT_ID = INITIAL_AGENT_ID_ENV;
    }
    return;
  }
  if (typeof parsed.value === "string") {
    process.env.SURFWRIGHT_AGENT_ID = parsed.value;
    return;
  }
  delete process.env.SURFWRIGHT_AGENT_ID;
}

const DOT_COMMAND_ALIAS_MAP = (() => {
  const map = new Map<string, string[]>();
  for (const command of [...runtimeCommandManifest, ...targetCommandManifest, ...networkCommandManifest]) {
    if (!command.id.includes(".")) {
      continue;
    }
    map.set(command.id, command.id.split("."));
  }
  return map;
})();

function rewriteDotCommandAlias(argv: string[]): string[] {
  const out = [...argv];
  let commandIndex = 2;

  while (commandIndex < out.length) {
    const token = out[commandIndex];
    if (token === "--") {
      return out;
    }

    const sessionSpan = parseOptionTokenSpan(out, commandIndex, "--session");
    if (sessionSpan > 0) {
      commandIndex += sessionSpan;
      continue;
    }
    const agentIdSpan = parseOptionTokenSpan(out, commandIndex, "--agent-id");
    if (agentIdSpan > 0) {
      commandIndex += agentIdSpan;
      continue;
    }

    if (token === "--json" || token === "--pretty") {
      commandIndex += 1;
      continue;
    }

    if (token.startsWith("-")) {
      commandIndex += 1;
      continue;
    }

    const alias = DOT_COMMAND_ALIAS_MAP.get(token);
    if (alias) {
      out.splice(commandIndex, 1, ...alias);
    }
    return out;
  }

  return out;
}

function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  return rewriteDotCommandAlias(out);
}

function parseCommandPath(argv: string[]): string[] {
  const out: string[] = [];
  let index = 2;

  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    const sessionSpan = parseOptionTokenSpan(argv, index, "--session");
    if (sessionSpan > 0) {
      index += sessionSpan;
      continue;
    }
    const agentIdSpan = parseOptionTokenSpan(argv, index, "--agent-id");
    if (agentIdSpan > 0) {
      index += agentIdSpan;
      continue;
    }
    if (token === "--json" || token === "--pretty") {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      break;
    }

    out.push(token);
    index += 1;

    if (out.length >= 2) {
      break;
    }
    if (out.length === 1 && out[0] !== "target" && out[0] !== "session" && out[0] !== "state") {
      break;
    }
  }

  return out;
}

function shouldBypassDaemon(argv: string[]): boolean {
  const [first, second] = parseCommandPath(argv);
  if (!first) {
    return true;
  }
  if (first.startsWith("__")) {
    return true;
  }
  if (first === "target" && second === "network-tail") {
    // Keep streaming command direct to avoid daemon buffering latency/memory.
    return true;
  }
  if (first === "target" && second === "console-tail") {
    // Keep streaming command direct to avoid daemon buffering latency/memory.
    return true;
  }
  if (first === "run") {
    for (let index = 2; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === "--plan" && argv[index + 1] === "-") {
        return true;
      }
      if (token === "--plan=-") {
        return true;
      }
    }
  }
  return false;
}

function createProgram(): Command {
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
    .option("--agent-id <agentId>", "Agent scope id for isolated state/daemon namespace")
    .option("--session <sessionId>", "Use a specific session for this command")
    .exitOverride();

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

  return program;
}

function commanderExitCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const maybe = error as { exitCode?: unknown };
  if (typeof maybe.exitCode !== "number" || !Number.isFinite(maybe.exitCode)) {
    return null;
  }
  return Math.max(0, Math.floor(maybe.exitCode));
}

async function runLocalCommand(argv: string[]): Promise<number> {
  applyAgentIdOverrideFromArgv(argv);
  const program = createProgram();
  process.exitCode = 0;

  try {
    await program.parseAsync(normalizeArgv(argv));
  } catch (error) {
    const exitCode = commanderExitCode(error);
    if (exitCode !== null) {
      process.exitCode = exitCode;
      return exitCode;
    }
    throw error;
  }

  return process.exitCode ?? 0;
}

function captureWrite(
  chunks: string[],
): (chunk: Uint8Array | string, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => boolean {
  return (chunk, encoding, callback) => {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else {
      const parsedEncoding = typeof encoding === "string" ? encoding : "utf8";
      chunks.push(Buffer.from(chunk).toString(parsedEncoding));
    }

    if (typeof encoding === "function") {
      encoding(null);
    }
    if (typeof callback === "function") {
      callback(null);
    }
    return true;
  };
}

async function runLocalCommandCaptured(argv: string[]): Promise<DaemonRunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const stdoutRef = process.stdout as unknown as { write: typeof process.stdout.write };
  const stderrRef = process.stderr as unknown as { write: typeof process.stderr.write };

  const originalStdoutWrite = stdoutRef.write;
  const originalStderrWrite = stderrRef.write;

  stdoutRef.write = captureWrite(stdoutChunks) as typeof process.stdout.write;
  stderrRef.write = captureWrite(stderrChunks) as typeof process.stderr.write;

  try {
    const code = await runLocalCommand(argv);
    return {
      code,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  } finally {
    stdoutRef.write = originalStdoutWrite;
    stderrRef.write = originalStderrWrite;
  }
}

async function maybeRunInternalWorker(argv: string[]): Promise<number | null> {
  if (argv[2] === "__network-worker") {
    try {
      const workerOpts = parseWorkerArgv(argv.slice(3));
      await runTargetNetworkWorker(workerOpts);
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
    return process.exitCode ?? 0;
  }

  if (argv[2] === "__daemon-worker") {
    let daemonToken = "";
    try {
      const workerOpts = parseDaemonWorkerArgv(argv.slice(3));
      daemonToken = workerOpts.token;
      await runDaemonWorker({
        port: workerOpts.port,
        token: workerOpts.token,
        onRun: async (requestArgv) => await runLocalCommandCaptured(requestArgv),
      });
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    } finally {
      if (daemonToken.length > 0) {
        cleanupOwnedDaemonMeta(daemonToken);
      }
    }
    return process.exitCode ?? 0;
  }

  return null;
}

async function main(argv: string[]): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  applyAgentIdOverrideFromArgv(normalizedArgv);

  const workerExitCode = await maybeRunInternalWorker(normalizedArgv);
  if (workerExitCode !== null) {
    return workerExitCode;
  }

  if (!shouldBypassDaemon(normalizedArgv)) {
    const proxied = await runViaDaemon(normalizedArgv, normalizedArgv[1] ?? process.argv[1]);
    if (proxied) {
      if (proxied.stdout.length > 0) {
        process.stdout.write(proxied.stdout);
      }
      if (proxied.stderr.length > 0) {
        process.stderr.write(proxied.stderr);
      }
      process.exitCode = proxied.code;
      return proxied.code;
    }
  }

  return await runLocalCommand(normalizedArgv);
}

const exitCode = await main(process.argv);
process.exitCode = exitCode;
