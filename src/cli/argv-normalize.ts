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
  return rewriteLegacyTargetOption(rewriteDotCommandAlias(out));
}
