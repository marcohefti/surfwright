import type { CliFailure } from "../core/types.js";
import { parseCommandPath } from "./options.js";

export type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

export function commanderExitCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const maybe = error as { exitCode?: unknown };
  if (typeof maybe.exitCode !== "number" || !Number.isFinite(maybe.exitCode)) {
    return null;
  }
  return Math.max(0, Math.floor(maybe.exitCode));
}

export function parseOutputOptsFromArgv(argv: string[]): OutputOpts {
  let json = true;
  let pretty = false;
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--no-json") {
      json = false;
      continue;
    }
    if (token === "--pretty") {
      pretty = true;
    }
  }
  return { json, pretty };
}

function contractUnknownOptionHints(unknownOption: string | null, argv?: string[]): string[] {
  if (!unknownOption || !Array.isArray(argv)) {
    return [];
  }
  const commandPath = parseCommandPath(argv);
  if (commandPath[0] !== "contract") {
    return [];
  }
  if (unknownOption !== "--kind" && unknownOption !== "--format") {
    return [];
  }
  return [
    "Use --search <term> to filter command/error/guidance entries.",
    "contract output is compact by default; add --full only when needed.",
    "Example: surfwright contract --search upload",
  ];
}

function sessionClearFailureHints(input: {
  commandPath: string[];
  unknownOption: string | null;
  tooManyArgs: boolean;
}): string[] {
  if (input.commandPath[0] !== "session" || input.commandPath[1] !== "clear") {
    return [];
  }
  const hints: string[] = [];
  if (input.tooManyArgs) {
    hints.push("Use `surfwright session clear --session <id>` for scoped cleanup.");
  }
  if (input.unknownOption === "--no-prompt") {
    hints.push("`session clear` is non-interactive; remove `--no-prompt`.");
  }
  if (typeof input.unknownOption === "string" && input.unknownOption.startsWith("--keep-processes=")) {
    hints.push("Use `--keep-processes` for true, and omit the flag for false (not `--keep-processes=<bool>`).");
  }
  if (hints.length > 0) {
    hints.push("Use `surfwright session list` first when you need to clear one known session.");
  }
  return hints;
}

export function toCommanderFailure(error: unknown, argv?: string[]): CliFailure | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const maybe = error as { code?: unknown; message?: unknown };
  if (typeof maybe.code !== "string" || !maybe.code.startsWith("commander.")) {
    return null;
  }
  const rawMessage = typeof maybe.message === "string" ? maybe.message : "invalid command input";
  const message = rawMessage.replace(/^error:\s*/i, "").trim();
  const didYouMeanMatch = /Did you mean\s+(.+?)\?/i.exec(rawMessage);
  const didYouMean = didYouMeanMatch?.[1]?.trim() ?? null;
  const missingArgMatch = /missing required argument '([^']+)'/i.exec(rawMessage);
  const unknownOptionMatch = /unknown option '([^']+)'/i.exec(rawMessage);
  const tooManyArgsMatch = /too many arguments(?: for '([^']+)')?/i.exec(rawMessage);
  const hintContext: Record<string, string | number | boolean | null> = {
    commanderCode: maybe.code,
    didYouMean,
    expectedArgs: missingArgMatch?.[1] ?? null,
    unknownOption: unknownOptionMatch?.[1] ?? null,
  };
  const parsedCommandPath = Array.isArray(argv) ? parseCommandPath(argv) : [];
  const commandPath = parsedCommandPath.join(" ");
  if (commandPath.length > 0) {
    hintContext.commandPath = commandPath;
  }
  let example: string | null = null;
  if (didYouMean) {
    example = `Try: surfwright ${didYouMean}`;
  } else if (missingArgMatch?.[1]) {
    example = "Run with --help to see required arguments";
  } else if (tooManyArgsMatch) {
    example = "Run with --help to see expected positional arguments";
  }
  const hints = [
    didYouMean ? `Did you mean ${didYouMean}?` : null,
    example,
    ...sessionClearFailureHints({
      commandPath: parsedCommandPath,
      unknownOption: unknownOptionMatch?.[1] ?? null,
      tooManyArgs: Boolean(tooManyArgsMatch),
    }),
    ...contractUnknownOptionHints(unknownOptionMatch?.[1] ?? null, argv),
    "Run the command with --help for usage examples",
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  return {
    ok: false,
    code: "E_QUERY_INVALID",
    message: message.length > 0 ? message : "invalid command input",
    ...(hints.length > 0 ? { hints: hints.slice(0, 3) } : {}),
    hintContext,
  };
}
