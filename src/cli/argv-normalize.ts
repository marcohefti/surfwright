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
    const workspaceSpan = parseOptionTokenSpan(out, commandIndex, "--workspace");
    if (workspaceSpan > 0) {
      commandIndex += workspaceSpan;
      continue;
    }
    const outputShapeSpan = parseOptionTokenSpan(out, commandIndex, "--output-shape");
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
    const alias = DOT_COMMAND_ALIAS_MAP.get(token);
    if (alias) {
      out.splice(commandIndex, 1, ...alias);
    }
    return out;
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
