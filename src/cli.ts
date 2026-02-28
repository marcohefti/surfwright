#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { CliError, toCliFailure } from "./core/errors.js";
import {
  cleanupOwnedDaemonMeta,
  emitDaemonFallbackDiagnostics,
  parseDaemonWorkerArgv,
  runDaemonWorker,
  runViaDaemon,
} from "./core/daemon/index.js";
import { runDaemonCommandOrchestrator } from "./core/daemon/app/index.js";
import type { CliFailure } from "./core/types.js";
import { parseWorkerArgv, runTargetNetworkWorker } from "./features/network/index.js";
import { allCommandManifest, registerFeaturePlugins } from "./features/registry.js";
import { kickOpportunisticStateMaintenance, runOpportunisticStateMaintenanceWorker } from "./core/state/public.js";
import { parseGlobalOptionValue } from "./cli/options.js";
import { resolveArgvCommandId, resolveArgvCommandPath } from "./cli/command-path.js";
import { commanderExitCode, parseOutputOptsFromArgv, toCommanderFailure, type OutputOpts } from "./cli/commander-failure.js";
import { normalizeArgv } from "./cli/argv-normalize.js";
import { getRequestExitCode, requestContextEnvGet, setRequestExitCode, withRequestContext } from "./core/request-context.js";

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
    throw new CliError("E_QUERY_INVALID", "timeout-ms must be a positive integer");
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError("E_QUERY_INVALID", "timeout-ms must be a positive integer");
  }
  return value;
}

function resolveRequestEnvOverrides(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const applyIfValid = (flag: string, envName: string): void => {
    const parsed = parseGlobalOptionValue(argv, flag);
    if (!parsed.found || !parsed.valid) {
      return;
    }
    out[envName] = typeof parsed.value === "string" ? parsed.value : undefined;
  };
  applyIfValid("--agent-id", "SURFWRIGHT_AGENT_ID");
  applyIfValid("--workspace", "SURFWRIGHT_WORKSPACE_DIR");
  applyIfValid("--output-shape", "SURFWRIGHT_OUTPUT_SHAPE");
  return out;
}

function shouldBypassDaemonFromContract(commandId: string): boolean {
  const manifest = allCommandManifest.find((entry) => entry.id === commandId);
  if (!manifest) {
    return false;
  }
  return manifest.execution?.daemon === "bypass" || manifest.execution?.streaming === true;
}

const DAEMON_BYPASS_COMMAND_IDS = new Set(
  allCommandManifest
    .map((entry) => entry.id)
    .filter((commandId) => shouldBypassDaemonFromContract(commandId)),
);

function shouldBypassDaemon(argv: string[]): boolean {
  const commandId = resolveArgvCommandId(argv);
  if (!commandId) {
    return true;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    return true;
  }
  if (commandId.startsWith("__")) {
    return true;
  }
  if (DAEMON_BYPASS_COMMAND_IDS.has(commandId)) {
    // Commands that rely on cwd-local IO or streaming stay direct to avoid daemon buffering/path ambiguity.
    return true;
  }
  if (commandId === "run") {
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
    setRequestExitCode(1);
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
  const envOverrides = resolveRequestEnvOverrides(argv);
  return await withRequestContext({
    envOverrides,
    initialExitCode: 0,
    run: async () => {
      const [firstCommand] = resolveArgvCommandPath(argv);
      if (firstCommand && !firstCommand.startsWith("__")) {
        kickOpportunisticStateMaintenance(argv[1] ?? process.argv[1] ?? "");
      }
      const program = createProgram();
      setRequestExitCode(0);
      try {
        await program.parseAsync(normalizeArgv(argv));
      } catch (error) {
        const exitCode = commanderExitCode(error);
        if (exitCode !== null) {
          if (exitCode > 0) {
            const output = parseOutputOptsFromArgv(argv);
            const failure = toCommanderFailure(error, argv);
            if (output.json && failure) {
              printFailure(failure, output);
            }
          }
          setRequestExitCode(exitCode);
          return exitCode;
        }
        throw error;
      }

      return getRequestExitCode(0);
    },
  });
}

async function maybeRunInternalWorker(argv: string[]): Promise<number | null> {
  if (argv[2] === "__network-worker") {
    try {
      const workerOpts = parseWorkerArgv(argv.slice(3));
      await runTargetNetworkWorker(workerOpts);
      setRequestExitCode(0);
    } catch {
      setRequestExitCode(1);
    }
    return getRequestExitCode(0);
  }

  if (argv[2] === "__daemon-worker") {
    let daemonToken = "";
    try {
      const workerOpts = parseDaemonWorkerArgv(argv.slice(3));
      daemonToken = workerOpts.token;
      await runDaemonWorker({
        port: workerOpts.port,
        token: workerOpts.token,
        onRun: async (requestArgv) =>
          await runDaemonCommandOrchestrator({
            argv: requestArgv,
            runLocalCommand,
            emitFailure: (failure) => {
              printFailure(failure, parseOutputOptsFromArgv(requestArgv));
            },
          }),
      });
      setRequestExitCode(0);
    } catch {
      setRequestExitCode(1);
    } finally {
      if (daemonToken.length > 0) {
        cleanupOwnedDaemonMeta(daemonToken);
      }
    }
    return getRequestExitCode(0);
  }

  if (argv[2] === "__maintenance-worker") {
    try {
      await runOpportunisticStateMaintenanceWorker();
      setRequestExitCode(0);
    } catch {
      setRequestExitCode(1);
    }
    return getRequestExitCode(0);
  }

  return null;
}

async function main(argv: string[]): Promise<number> {
  const normalizedArgv = normalizeArgv(argv);
  const envOverrides = resolveRequestEnvOverrides(normalizedArgv);
  return await withRequestContext({
    envOverrides,
    run: async () => {
      const workerExitCode = await maybeRunInternalWorker(normalizedArgv);
      if (workerExitCode !== null) {
        return workerExitCode;
      }

      if (!shouldBypassDaemon(normalizedArgv)) {
        const proxied = await runViaDaemon(normalizedArgv, normalizedArgv[1] ?? process.argv[1]);
        if (proxied.kind === "success") {
          if (proxied.result.stdout.length > 0) {
            process.stdout.write(proxied.result.stdout);
          }
          if (proxied.result.stderr.length > 0) {
            process.stderr.write(proxied.result.stderr);
          }
          setRequestExitCode(proxied.result.code);
          return proxied.result.code;
        }
        if (proxied.kind === "typed_daemon_error") {
          printFailure(
            {
              ok: false,
              code: proxied.code,
              message: proxied.message,
            },
            parseOutputOptsFromArgv(normalizedArgv),
          );
          setRequestExitCode(1);
          return 1;
        }
        if (requestContextEnvGet("SURFWRIGHT_DEBUG_LOGS") === "1") {
          process.stderr.write(`[daemon] local fallback due to unreachable daemon: ${proxied.message}\n`);
          emitDaemonFallbackDiagnostics({
            command: resolveArgvCommandPath(normalizedArgv).join(" "),
            message: proxied.message,
          });
        }
      }

      return await runLocalCommand(normalizedArgv);
    }
  });
}

const exitCode = await main(process.argv);
process.exitCode = exitCode;
