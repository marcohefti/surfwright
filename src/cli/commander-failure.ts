import type { CliFailure } from "../core/types.js";

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

export function toCommanderFailure(error: unknown): CliFailure | null {
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
