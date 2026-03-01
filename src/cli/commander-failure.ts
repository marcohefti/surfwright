import type { CliFailure } from "../core/types.js";
import { findCommandContractByPath, usageRequiredPositionals, usageValidFlags } from "../core/cli-contract.js";
import { resolveArgvCommandPath } from "./command-path.js";

export type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

function commanderDiagnostics(input: {
  commandPath: string[];
  unknownOption: string | null;
  missingArg: string | null;
  tooManyArgs: boolean;
}): CliFailure["diagnostics"] {
  const diagnostics: NonNullable<CliFailure["diagnostics"]> = {};
  if (typeof input.unknownOption === "string" && input.unknownOption.length > 0) {
    diagnostics.unknownFlags = [input.unknownOption];
  }
  if (typeof input.missingArg === "string" && input.missingArg.length > 0) {
    diagnostics.expectedPositionals = [input.missingArg];
  }

  const contract = findCommandContractByPath(input.commandPath);
  if (contract) {
    const validFlags = usageValidFlags(contract.usage);
    if (validFlags.length > 0) {
      diagnostics.validFlags = validFlags;
    }
    diagnostics.canonicalInvocation = contract.usage;
    if (!diagnostics.expectedPositionals && input.tooManyArgs) {
      const expectedPositionals = usageRequiredPositionals(contract.usage);
      if (expectedPositionals.length > 0) {
        diagnostics.expectedPositionals = expectedPositionals;
      }
    }
  }

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

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
  const commandPath = resolveArgvCommandPath(argv);
  if (commandPath[0] !== "contract") {
    return [];
  }
  if (unknownOption !== "--kind" && unknownOption !== "--format") {
    return [];
  }
  return [
    "Use --command <id> for one compact command schema (flags/positionals/examples).",
    "Use --commands <id1,id2> for one-shot multi-command schemas.",
    "Use --full for full commandIds/errorCodes catalogs.",
  ];
}

function resolveContractLookupCommand(commandPath: string[]): string {
  if (!Array.isArray(commandPath) || commandPath.length === 0) {
    return "surfwright contract";
  }
  const lookup = commandPath.join(".");
  return `surfwright contract --command ${lookup}`;
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
  const unknownOption = unknownOptionMatch?.[1] ?? null;
  const expectedArg = missingArgMatch?.[1] ?? null;
  const hintContext: Record<string, string | number | boolean | null> = {
    commanderCode: maybe.code,
    didYouMean,
    expectedArgs: expectedArg,
    unknownOption,
  };
  const parsedCommandPath = Array.isArray(argv) ? resolveArgvCommandPath(argv) : [];
  const commandPath = parsedCommandPath.join(" ");
  const canonicalCommandId = parsedCommandPath.join(".");
  if (commandPath.length > 0) {
    hintContext.commandPath = commandPath;
    hintContext.canonicalCommandId = canonicalCommandId;
  }
  let example: string | null = null;
  if (didYouMean) {
    example = `Try: surfwright ${didYouMean}`;
  } else if (missingArgMatch?.[1]) {
    example = "Use the canonical invocation in diagnostics.canonicalInvocation";
  } else if (tooManyArgsMatch) {
    example = "Use the canonical invocation in diagnostics.canonicalInvocation";
  }
  const hints = [
    didYouMean ? `Did you mean ${didYouMean}?` : null,
    example,
    ...sessionClearFailureHints({
      commandPath: parsedCommandPath,
      unknownOption,
      tooManyArgs: Boolean(tooManyArgsMatch),
    }),
    ...contractUnknownOptionHints(unknownOption, argv),
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  const diagnostics = commanderDiagnostics({
    commandPath: parsedCommandPath,
    unknownOption,
    missingArg: expectedArg,
    tooManyArgs: Boolean(tooManyArgsMatch),
  });
  const recovery: CliFailure["recovery"] = (() => {
    if (didYouMean) {
      return {
        strategy: "retry-with-suggested-command",
        nextCommand: `surfwright ${didYouMean}`,
        requiredFields: ["commandPath"],
        context: {
          commandPath: commandPath.length > 0 ? commandPath : null,
          unknownOption: unknownOption ?? null,
        },
      };
    }
    if (unknownOption) {
      return {
        strategy: "retry-with-valid-flags",
        nextCommand: resolveContractLookupCommand(parsedCommandPath),
        requiredFields: ["validFlags"],
        context: {
          unknownOption,
          commandPath: commandPath.length > 0 ? commandPath : null,
        },
      };
    }
    if (expectedArg) {
      return {
        strategy: "retry-with-required-positionals",
        nextCommand: resolveContractLookupCommand(parsedCommandPath),
        requiredFields: ["expectedPositionals"],
        context: {
          commandPath: commandPath.length > 0 ? commandPath : null,
          unknownOption: unknownOption ?? null,
        },
      };
    }
    return undefined;
  })();

  return {
    ok: false,
    code: "E_QUERY_INVALID",
    message: message.length > 0 ? message : "invalid command input",
    ...(recovery ? { recovery } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(hints.length > 0 ? { hints: hints.slice(0, 3) } : {}),
    hintContext,
  };
}
