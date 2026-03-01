import { allCommandManifest } from "../features/registry.js";
import { parseOptionTokenSpan } from "./options.js";

const LEGACY_DOT_ALIAS_MAP = new Map<string, string[]>([
  ["session.create", ["session", "new"]],
  ["target.clickread", ["target", "click-read"]],
  ["target.clickat", ["target", "click-at"]],
]);

const COMMAND_ID_TO_PATH = new Map<string, string[]>();
const REQUIRED_POSITIONAL_COUNT = new Map<string, number>();

for (const command of allCommandManifest) {
  const pathTokens = command.id.split(".");
  COMMAND_ID_TO_PATH.set(command.id, pathTokens);
  REQUIRED_POSITIONAL_COUNT.set(command.id, countRequiredPositionals(command.usage));
}

const DOT_COMMAND_ALIAS_MAP = (() => {
  const map = new Map<string, string[]>();
  for (const command of allCommandManifest) {
    if (!command.id.includes(".")) {
      continue;
    }
    map.set(command.id, command.id.split("."));
    map.set(command.id.toLowerCase(), command.id.split("."));
  }
  return map;
})();

function countRequiredPositionals(usage: string): number {
  const text = String(usage ?? "");
  const beforeOptional = text.split("[")[0] ?? text;
  const matches = beforeOptional.match(/<([^>\s]+)>/g) ?? [];
  return matches.length;
}

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
  const rawToken = out[commandIndex];
  const alias =
    DOT_COMMAND_ALIAS_MAP.get(rawToken) ??
    DOT_COMMAND_ALIAS_MAP.get(rawToken.toLowerCase()) ??
    LEGACY_DOT_ALIAS_MAP.get(rawToken.toLowerCase());
  if (alias) {
    out.splice(commandIndex, 1, ...alias);
  }
  return out;
}

const AGENT_DISCOVERY_REDIRECT_IDS = new Set<string>([
  "open",
  "target.find",
  "target.click",
  "target.spawn",
  "target.fill",
  "target.eval",
  "target.read",
  "target.wait",
]);

function resolveCommandPathAt(argv: string[], commandIndex: number): { id: string; pathLength: number } | null {
  const maxPathLength = Math.min(3, argv.length - commandIndex);
  for (let length = maxPathLength; length >= 1; length -= 1) {
    const tokens = argv.slice(commandIndex, commandIndex + length);
    if (tokens.some((token) => token.startsWith("-"))) {
      continue;
    }
    const id = tokens.join(".");
    if (COMMAND_ID_TO_PATH.has(id)) {
      return { id, pathLength: length };
    }
  }
  return null;
}

function rewriteAgentNoArgDiscovery(argv: string[]): string[] {
  const out = [...argv];
  const commandIndex = firstCommandIndex(out);
  if (commandIndex < 0) {
    return out;
  }
  const resolved = resolveCommandPathAt(out, commandIndex);
  if (!resolved) {
    return out;
  }
  const requiredPositionals = REQUIRED_POSITIONAL_COUNT.get(resolved.id) ?? 0;
  const hasOnlyCommandPath = out.length === commandIndex + resolved.pathLength;
  if (!hasOnlyCommandPath || requiredPositionals < 1 || !AGENT_DISCOVERY_REDIRECT_IDS.has(resolved.id)) {
    return out;
  }
  out.splice(commandIndex, resolved.pathLength, "contract", "--command", resolved.id);
  return out;
}

export function normalizeArgv(argv: string[]): string[] {
  const out = [...argv];
  if (out[2] === "--") {
    out.splice(2, 1);
  }
  return rewriteAgentNoArgDiscovery(rewriteDotCommandAlias(out));
}
