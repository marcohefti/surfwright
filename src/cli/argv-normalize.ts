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

function rewriteHelpCommandAlias(argv: string[]): string[] {
  const out = [...argv];
  const commandIndex = firstCommandIndex(out);
  if (commandIndex < 0 || out[commandIndex] !== "help") {
    return out;
  }

  const pathStart = commandIndex + 1;
  if (pathStart >= out.length || out[pathStart].startsWith("-")) {
    return out;
  }

  let pathEnd = pathStart;
  while (pathEnd < out.length) {
    const token = out[pathEnd];
    if (token === "--" || token.startsWith("-")) {
      break;
    }
    pathEnd += 1;
  }
  if (pathEnd <= pathStart) {
    return out;
  }

  const rawPath = out.slice(pathStart, pathEnd);
  const resolvedPath =
    rawPath.length === 1 && DOT_COMMAND_ALIAS_MAP.has(rawPath[0]) ? DOT_COMMAND_ALIAS_MAP.get(rawPath[0]) ?? rawPath : rawPath;
  out.splice(commandIndex, 1 + rawPath.length, ...resolvedPath, "--help");
  return out;
}

function rewriteContractSearchArgv(argv: string[]): string[] {
  const out = [...argv];
  const commandIndex = firstCommandIndex(out);
  if (commandIndex < 0 || out[commandIndex] !== "contract") {
    return out;
  }

  for (let index = commandIndex + 1; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token !== "--search") {
      if (token.startsWith("--search=")) {
        const seed = token.slice("--search=".length);
        if (seed.length === 0) {
          continue;
        }
        let end = index + 1;
        while (end < out.length) {
          const next = out[end];
          if (next === "--" || next.startsWith("-")) {
            break;
          }
          end += 1;
        }
        if (end <= index + 1) {
          continue;
        }
        const merged = [seed, ...out.slice(index + 1, end)].join(" ");
        out.splice(index, end - index, `--search=${merged}`);
      }
      continue;
    }
    const searchValueIndex = index + 1;
    if (searchValueIndex >= out.length) {
      return out;
    }
    const searchValue = out[searchValueIndex];
    if (searchValue === "--" || searchValue.startsWith("-")) {
      return out;
    }
    let end = searchValueIndex + 1;
    while (end < out.length) {
      const next = out[end];
      if (next === "--" || next.startsWith("-")) {
        break;
      }
      end += 1;
    }
    if (end <= searchValueIndex + 1) {
      return out;
    }
    const merged = [searchValue, ...out.slice(searchValueIndex + 1, end)].join(" ");
    out.splice(searchValueIndex, end - searchValueIndex, merged);
    return out;
  }

  return out;
}

export function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  const withDotAliases = rewriteDotCommandAlias(out);
  const withHelpAliases = rewriteHelpCommandAlias(withDotAliases);
  return rewriteContractSearchArgv(withHelpAliases);
}
