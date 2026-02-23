import { allCommandManifest } from "../features/registry.js";
import { parseCommandPath, parseOptionTokenSpan } from "./options.js";

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

const TARGET_SUBCOMMANDS_WITH_REQUIRED_TARGET_ID = new Set([
  "frames",
  "snapshot",
  "count",
  "find",
  "click",
  "click-read",
  "download",
  "click-at",
  "fill",
  "form-fill",
  "upload",
  "keypress",
  "drag-drop",
  "spawn",
  "close",
  "dialog",
  "emulate",
  "screenshot",
  "style",
  "hover",
  "read",
  "extract",
  "eval",
  "observe",
  "motion-detect",
  "scroll-plan",
  "scroll-sample",
  "scroll-watch",
  "scroll-reveal-scan",
  "sticky-check",
  "transition-assert",
  "transition-trace",
  "wait",
  "url-assert",
  "console-get",
  "console-tail",
  "health",
  "hud",
  "network",
  "network-around",
  "network-begin",
  "trace",
]);

const BOOLEAN_TRUE_VALUES = new Set(["1", "true", "yes"]);
const BOOLEAN_FALSE_VALUES = new Set(["0", "false", "no"]);

function parseBooleanLiteral(input: string): boolean | null {
  const normalized = input.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (BOOLEAN_FALSE_VALUES.has(normalized)) {
    return false;
  }
  return null;
}

function findCommandTokenIndices(argv: string[]): number[] {
  const out: number[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    if (token === "--json" || token === "--no-json" || token === "--pretty") {
      continue;
    }
    const sessionSpan = parseOptionTokenSpan(argv, index, "--session");
    if (sessionSpan > 0) {
      index += sessionSpan - 1;
      continue;
    }
    const agentIdSpan = parseOptionTokenSpan(argv, index, "--agent-id");
    if (agentIdSpan > 0) {
      index += agentIdSpan - 1;
      continue;
    }
    const workspaceSpan = parseOptionTokenSpan(argv, index, "--workspace");
    if (workspaceSpan > 0) {
      index += workspaceSpan - 1;
      continue;
    }
    const outputShapeSpan = parseOptionTokenSpan(argv, index, "--output-shape");
    if (outputShapeSpan > 0) {
      index += outputShapeSpan - 1;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    out.push(index);
    if (out.length >= 2) {
      break;
    }
    if (out.length === 1 && token !== "target" && token !== "session" && token !== "state" && token !== "workspace") {
      break;
    }
  }
  return out;
}

function rewriteLegacyTargetOption(argv: string[]): string[] {
  const out = [...argv];
  const command = parseCommandPath(out);
  if (command[0] !== "target") {
    return out;
  }
  const subcommand = command[1] ?? "";
  if (!TARGET_SUBCOMMANDS_WITH_REQUIRED_TARGET_ID.has(subcommand)) {
    return out;
  }

  let subIndex = -1;
  for (let index = 2; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token === "--json" || token === "--no-json" || token === "--pretty") {
      continue;
    }
    const sessionSpan = parseOptionTokenSpan(out, index, "--session");
    if (sessionSpan > 0) {
      index += sessionSpan - 1;
      continue;
    }
    const agentIdSpan = parseOptionTokenSpan(out, index, "--agent-id");
    if (agentIdSpan > 0) {
      index += agentIdSpan - 1;
      continue;
    }
    const workspaceSpan = parseOptionTokenSpan(out, index, "--workspace");
    if (workspaceSpan > 0) {
      index += workspaceSpan - 1;
      continue;
    }
    const outputShapeSpan = parseOptionTokenSpan(out, index, "--output-shape");
    if (outputShapeSpan > 0) {
      index += outputShapeSpan - 1;
      continue;
    }
    if (token === "target") {
      const next = out[index + 1];
      if (typeof next === "string" && !next.startsWith("-")) {
        subIndex = index + 1;
      }
      break;
    }
  }
  if (subIndex < 0) {
    return out;
  }

  const maybeTargetId = out[subIndex + 1];
  if (typeof maybeTargetId === "string" && !maybeTargetId.startsWith("-")) {
    return out;
  }

  let aliasValue: string | null = null;
  let aliasIndex = -1;
  let aliasSpan = 0;
  for (let index = subIndex + 1; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token === "--target") {
      const next = out[index + 1];
      if (typeof next === "string" && !next.startsWith("-")) {
        aliasValue = next;
        aliasIndex = index;
        aliasSpan = 2;
      }
      break;
    }
    if (token.startsWith("--target=")) {
      const value = token.slice("--target=".length).trim();
      if (value.length > 0) {
        aliasValue = value;
        aliasIndex = index;
        aliasSpan = 1;
      }
      break;
    }
  }

  if (!aliasValue || aliasIndex < 0 || aliasSpan < 1) {
    return out;
  }
  out.splice(aliasIndex, aliasSpan);
  out.splice(subIndex + 1, 0, aliasValue);
  return out;
}

function rewriteSessionClearCompatibility(argv: string[]): string[] {
  const out = [...argv];
  const command = parseCommandPath(out);
  if (command[0] !== "session" || command[1] !== "clear") {
    return out;
  }
  const commandIndices = findCommandTokenIndices(out);
  if (commandIndices.length < 2) {
    return out;
  }
  const clearIndex = commandIndices[1];

  for (let index = clearIndex + 1; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token === "--no-prompt") {
      // session clear is always non-interactive; tolerate generic wrapper flags.
      out.splice(index, 1);
      index -= 1;
      continue;
    }
    if (token.startsWith("--keep-processes=")) {
      const parsed = parseBooleanLiteral(token.slice("--keep-processes=".length));
      if (parsed !== null) {
        if (parsed) {
          out[index] = "--keep-processes";
        } else {
          out.splice(index, 1);
          index -= 1;
        }
      }
      continue;
    }
    if (token === "--keep-processes") {
      const next = out[index + 1];
      if (typeof next === "string" && !next.startsWith("-")) {
        const parsed = parseBooleanLiteral(next);
        if (parsed !== null) {
          if (parsed) {
            out.splice(index + 1, 1);
          } else {
            out.splice(index, 2);
            index -= 1;
          }
        }
      }
      continue;
    }
  }

  let scopedSessionValue: string | null = null;
  let scopedSessionIndex = -1;
  let scopedSessionSpan = 0;
  for (let index = clearIndex + 1; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token === "--json" || token === "--no-json" || token === "--pretty") {
      continue;
    }
    const sessionSpan = parseOptionTokenSpan(out, index, "--session");
    if (sessionSpan > 0) {
      const value =
        token === "--session"
          ? out[index + 1]
          : token.startsWith("--session=")
            ? token.slice("--session=".length)
            : null;
      if (typeof value === "string" && value.trim().length > 0) {
        scopedSessionValue = value;
        scopedSessionIndex = index;
        scopedSessionSpan = sessionSpan;
        break;
      }
      index += sessionSpan - 1;
      continue;
    }
    const timeoutSpan = parseOptionTokenSpan(out, index, "--timeout-ms");
    if (timeoutSpan > 0) {
      index += timeoutSpan - 1;
      continue;
    }
    if (token === "--keep-processes") {
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    scopedSessionValue = token;
    scopedSessionIndex = index;
    scopedSessionSpan = 1;
    break;
  }

  const hasGlobalSessionScope = (() => {
    const firstCommandIndex = commandIndices[0] ?? 2;
    for (let index = 2; index < firstCommandIndex; index += 1) {
      const span = parseOptionTokenSpan(out, index, "--session");
      if (span > 0) {
        const token = out[index];
        if (token === "--session") {
          const value = out[index + 1];
          if (typeof value === "string" && value.trim().length > 0) {
            return true;
          }
        } else if (token.startsWith("--session=")) {
          const value = token.slice("--session=".length);
          if (value.trim().length > 0) {
            return true;
          }
        }
        index += span - 1;
      }
    }
    return false;
  })();

  if (scopedSessionValue && scopedSessionIndex > 0) {
    out.splice(scopedSessionIndex, scopedSessionSpan);
    if (!hasGlobalSessionScope) {
      out.splice(2, 0, "--session", scopedSessionValue);
    }
  }
  return out;
}

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
  return rewriteSessionClearCompatibility(rewriteLegacyTargetOption(rewriteDotCommandAlias(out)));
}
