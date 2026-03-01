import { allCommandManifest } from "../features/registry.js";
import { parseOptionTokenSpan } from "./options.js";

const DOT_COMMAND_ALIAS_MAP = (() => {
  const map = new Map<string, string[]>();
  for (const command of allCommandManifest) {
    if (!command.id.includes(".")) {
      continue;
    }
    map.set(command.id, command.id.split("."));
  }
  return map;
})();

function firstCommandIndex(argv: string[]): number {
  let commandIndex = 2;
  while (commandIndex < argv.length) {
    const token = argv[commandIndex];
    if (token === "--") {
      return -1;
    }
    const sessionSpan = parseOptionTokenSpan(argv, commandIndex, "--session");
    if (sessionSpan > 0) {
      commandIndex += sessionSpan;
      continue;
    }
    const agentIdSpan = parseOptionTokenSpan(argv, commandIndex, "--agent-id");
    if (agentIdSpan > 0) {
      commandIndex += agentIdSpan;
      continue;
    }
    const workspaceSpan = parseOptionTokenSpan(argv, commandIndex, "--workspace");
    if (workspaceSpan > 0) {
      commandIndex += workspaceSpan;
      continue;
    }
    const outputShapeSpan = parseOptionTokenSpan(argv, commandIndex, "--output-shape");
    if (outputShapeSpan > 0) {
      commandIndex += outputShapeSpan;
      continue;
    }
    if (token === "--json" || token === "--no-json" || token === "--pretty") {
      commandIndex += 1;
      continue;
    }
    if (token.startsWith("-")) {
      commandIndex += 1;
      continue;
    }
    return commandIndex;
  }
  return -1;
}

function rewriteDotCommandAlias(argv: string[]): string[] {
  const out = [...argv];
  const commandIndex = firstCommandIndex(out);
  if (commandIndex < 0) {
    return out;
  }
  const alias = DOT_COMMAND_ALIAS_MAP.get(out[commandIndex]);
  if (alias) {
    out.splice(commandIndex, 1, ...alias);
  }
  return out;
}

export function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  return rewriteDotCommandAlias(out);
}
