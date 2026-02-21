#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { toCliFailure } from "./core/errors.js";
import {
  cleanupOwnedDaemonMeta,
  parseDaemonWorkerArgv,
  runDaemonWorker,
  runViaDaemon,
  type DaemonRunResult,
} from "./core/daemon/index.js";
import type { CliFailure } from "./core/types.js";
import { parseWorkerArgv, runTargetNetworkWorker } from "./features/network/index.js";
import { registerFeaturePlugins } from "./features/registry.js";
import { setRuntimeOutputShapeInput } from "./core/report-fields.js";
import { parseCommandPath, parseGlobalOptionValue } from "./cli/options.js";
import { commanderExitCode, parseOutputOptsFromArgv, toCommanderFailure, type OutputOpts } from "./cli/commander-failure.js";
import { normalizeArgv } from "./cli/argv-normalize.js";

const INITIAL_AGENT_ID_ENV = typeof process.env.SURFWRIGHT_AGENT_ID === "string" ? process.env.SURFWRIGHT_AGENT_ID : null;
const INITIAL_WORKSPACE_DIR_ENV =
  typeof process.env.SURFWRIGHT_WORKSPACE_DIR === "string" ? process.env.SURFWRIGHT_WORKSPACE_DIR : null;
const INITIAL_OUTPUT_SHAPE_ENV =
  typeof process.env.SURFWRIGHT_OUTPUT_SHAPE === "string" ? process.env.SURFWRIGHT_OUTPUT_SHAPE : null;

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
  process.stderr.write(`error ${failure.code}: ${failure.message}\n`);
}

function parseTimeoutMs(input: string): number {
  const raw = input.trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error("timeout-ms must be a positive integer");
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("timeout-ms must be a positive integer");
  }
  return value;
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

function applyWorkspaceDirOverrideFromArgv(argv: string[]): void {
  const parsed = parseGlobalOptionValue(argv, "--workspace");
  if (!parsed.found || !parsed.valid) {
    if (INITIAL_WORKSPACE_DIR_ENV === null) {
      delete process.env.SURFWRIGHT_WORKSPACE_DIR;
    } else {
      process.env.SURFWRIGHT_WORKSPACE_DIR = INITIAL_WORKSPACE_DIR_ENV;
    }
    return;
  }
  if (typeof parsed.value === "string") {
    process.env.SURFWRIGHT_WORKSPACE_DIR = parsed.value;
    return;
  }
  delete process.env.SURFWRIGHT_WORKSPACE_DIR;
}

function applyOutputShapeOverrideFromArgv(argv: string[]): void {
  const parsed = parseGlobalOptionValue(argv, "--output-shape");
  if (!parsed.found || !parsed.valid) {
    if (INITIAL_OUTPUT_SHAPE_ENV === null) {
      delete process.env.SURFWRIGHT_OUTPUT_SHAPE;
    } else {
      process.env.SURFWRIGHT_OUTPUT_SHAPE = INITIAL_OUTPUT_SHAPE_ENV;
    }
    setRuntimeOutputShapeInput(process.env.SURFWRIGHT_OUTPUT_SHAPE);
    return;
  }
  if (typeof parsed.value === "string") {
    process.env.SURFWRIGHT_OUTPUT_SHAPE = parsed.value;
    setRuntimeOutputShapeInput(process.env.SURFWRIGHT_OUTPUT_SHAPE);
    return;
  }
  delete process.env.SURFWRIGHT_OUTPUT_SHAPE;
  setRuntimeOutputShapeInput(process.env.SURFWRIGHT_OUTPUT_SHAPE);
}

function shouldBypassDaemon(argv: string[]): boolean {
  const [first, second] = parseCommandPath(argv);
  if (!first) {
    return true;
  }
  if (first.startsWith("__")) {
    return true;
  }
  if (first === "skill") {
    // Skill commands often take local filesystem paths; resolve relative paths from operator cwd, not daemon worker cwd.
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
      // JSON is the default. `--no-json` opts into human summaries.
      json: globalOpts.json !== false,
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
    .option("--json", "Enable JSON output (default)")
    .option("--no-json", "Disable JSON output (human-friendly summaries)")
    .option("--pretty", "Pretty-print JSON output", false)
    .option("--agent-id <agentId>", "Agent scope id for isolated state/daemon namespace")
    .option("--workspace <dir>", "Workspace directory override for reusable profiles (default: auto-discover ./.surfwright)")
    .option("--session <sessionId>", "Use a specific session for this command")
    .addOption(
      new Option("--output-shape <shape>", "Output shape preset: full|compact|proof").choices(["full", "compact", "proof"]),
    )
    .showSuggestionAfterError(true)
    .showHelpAfterError("(run the command with --help for examples)")
    .exitOverride();
  registerFeaturePlugins({
    program,
    parseTimeoutMs,
    globalOutputOpts,
    handleFailure,
    readPackageVersion,
  });

  return program;
}

async function runLocalCommand(argv: string[]): Promise<number> {
  applyAgentIdOverrideFromArgv(argv);
  applyWorkspaceDirOverrideFromArgv(argv);
  applyOutputShapeOverrideFromArgv(argv);
  const program = createProgram();
  process.exitCode = 0;
  try {
    await program.parseAsync(normalizeArgv(argv));
  } catch (error) {
    const exitCode = commanderExitCode(error);
    if (exitCode !== null) {
      if (exitCode > 0) {
        const output = parseOutputOptsFromArgv(argv);
        const failure = toCommanderFailure(error);
        if (output.json && failure) {
          printFailure(failure, output);
        }
      }
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
  applyWorkspaceDirOverrideFromArgv(normalizedArgv);
  applyOutputShapeOverrideFromArgv(normalizedArgv);

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
