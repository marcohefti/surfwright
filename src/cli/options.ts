const GLOBAL_PATH_OPTIONS = ["--session", "--agent-id", "--workspace", "--output-shape"] as const;

export function parseOptionTokenSpan(argv: string[], index: number, optionName: string): number {
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

export function parseGlobalOptionValue(
  argv: string[],
  optionName: string,
): { found: boolean; valid: boolean; value: string | null } {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    if (token === optionName) {
      const next = index + 1 < argv.length ? argv[index + 1] : null;
      if (typeof next !== "string" || next === "--" || next.startsWith("-")) {
        return {
          found: true,
          valid: false,
          value: null,
        };
      }
      return {
        found: true,
        valid: true,
        value: next,
      };
    }
    const prefix = `${optionName}=`;
    if (token.startsWith(prefix)) {
      const value = token.slice(prefix.length);
      if (value.length === 0) {
        return {
          found: true,
          valid: false,
          value: null,
        };
      }
      return {
        found: true,
        valid: true,
        value,
      };
    }
  }
  return {
    found: false,
    valid: false,
    value: null,
  };
}

export function parseCommandPath(argv: string[]): string[] {
  const out: string[] = [];
  let index = 2;

  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      break;
    }

    let consumed = 0;
    for (const optionName of GLOBAL_PATH_OPTIONS) {
      consumed = parseOptionTokenSpan(argv, index, optionName);
      if (consumed > 0) {
        break;
      }
    }
    if (consumed > 0) {
      index += consumed;
      continue;
    }

    if (token === "--json" || token === "--no-json" || token === "--pretty") {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      break;
    }
    out.push(token);
    index += 1;
    if (out.length >= 2) {
      break;
    }
    if (out.length === 1 && out[0] !== "target" && out[0] !== "session" && out[0] !== "state" && out[0] !== "workspace") {
      break;
    }
  }

  return out;
}
