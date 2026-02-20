const TARGET_SUBCOMMANDS_WITH_POSITIONAL_ID = new Set([
  "frames",
  "snapshot",
  "click",
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
]);

function parseOptionTokenSpan(argv: string[], index: number, optionName: string): number {
  const token = argv[index];
  if (token === "--") {
    return 0;
  }
  if (token === optionName) {
    const next = index + 1 < argv.length ? argv[index + 1] : null;
    if (typeof next === "string" && next !== "--" && !next.startsWith("-")) {
      return 2;
    }
    return 1;
  }
  const prefix = `${optionName}=`;
  if (token.startsWith(prefix)) {
    return 1;
  }
  return 0;
}

function parseTargetOptionTokenSpan(argv: string[], index: number): number {
  const token = argv[index];
  if (token === "--") {
    return 0;
  }
  const targetSpan = parseOptionTokenSpan(argv, index, "--target");
  if (targetSpan > 0) {
    return targetSpan;
  }
  const targetIdSpan = parseOptionTokenSpan(argv, index, "--target-id");
  if (targetIdSpan > 0) {
    return targetIdSpan;
  }
  return 0;
}

function parseKnownGlobalTokenSpan(argv: string[], index: number): number {
  const token = argv[index];
  if (token === "--") {
    return 0;
  }
  const sessionSpan = parseOptionTokenSpan(argv, index, "--session");
  if (sessionSpan > 0) {
    return sessionSpan;
  }
  const agentIdSpan = parseOptionTokenSpan(argv, index, "--agent-id");
  if (agentIdSpan > 0) {
    return agentIdSpan;
  }
  const workspaceSpan = parseOptionTokenSpan(argv, index, "--workspace");
  if (workspaceSpan > 0) {
    return workspaceSpan;
  }
  if (token === "--json" || token === "--no-json" || token === "--pretty") {
    return 1;
  }
  return 0;
}

export function rewriteTargetIdOptionAlias(argv: string[]): string[] {
  const out = [...argv];
  let commandIndex = 2;
  while (commandIndex < out.length) {
    const token = out[commandIndex];
    if (token === "--") {
      return out;
    }
    const globalSpan = parseKnownGlobalTokenSpan(out, commandIndex);
    if (globalSpan > 0) {
      commandIndex += globalSpan;
      continue;
    }
    if (token.startsWith("-")) {
      commandIndex += 1;
      continue;
    }
    break;
  }

  if (out[commandIndex] !== "target") {
    return out;
  }
  const subcommand = out[commandIndex + 1];
  if (!subcommand || subcommand.startsWith("-") || !TARGET_SUBCOMMANDS_WITH_POSITIONAL_ID.has(subcommand)) {
    return out;
  }
  const argsStart = commandIndex + 2;

  for (let index = argsStart; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    const globalSpan = parseKnownGlobalTokenSpan(out, index);
    if (globalSpan > 0) {
      index += globalSpan - 1;
      continue;
    }
    const targetSpan = parseTargetOptionTokenSpan(out, index);
    if (targetSpan > 0) {
      index += targetSpan - 1;
      continue;
    }
    if (token.startsWith("-")) {
      if (token.includes("=")) {
        continue;
      }
      const next = index + 1 < out.length ? out[index + 1] : null;
      if (typeof next === "string" && next !== "--" && !next.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    return out;
  }

  for (let index = argsStart; index < out.length; index += 1) {
    const token = out[index];
    if (token === "--") {
      break;
    }
    if (token === "--target" || token === "--target-id") {
      const value = index + 1 < out.length ? out[index + 1] : null;
      if (typeof value === "string" && value !== "--" && !value.startsWith("-")) {
        out.splice(index, 2);
        out.splice(argsStart, 0, value);
      }
      return out;
    }
    if (token.startsWith("--target=")) {
      const value = token.slice("--target=".length);
      if (value.length > 0) {
        out.splice(index, 1);
        out.splice(argsStart, 0, value);
      }
      return out;
    }
    if (token.startsWith("--target-id=")) {
      const value = token.slice("--target-id=".length);
      if (value.length > 0) {
        out.splice(index, 1);
        out.splice(argsStart, 0, value);
      }
      return out;
    }
    if (token.startsWith("-") && !token.includes("=")) {
      const next = index + 1 < out.length ? out[index + 1] : null;
      if (typeof next === "string" && next !== "--" && !next.startsWith("-")) {
        index += 1;
      }
    }
  }

  return out;
}
