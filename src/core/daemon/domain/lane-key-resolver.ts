import { resolveArgvCommandPath } from "../../../cli/command-path.js";
import { parseGlobalOptionValue, parseOptionTokenSpan } from "../../../cli/options.js";

export const DAEMON_CONTROL_LANE_KEY = "control:default";

export type DaemonLaneSource = "sessionId" | "cdpOrigin" | "control";
export type DaemonLaneFamily = "open" | "run" | "session.attach" | "target" | "control";

export type DaemonLaneResolution = {
  laneKey: string;
  source: DaemonLaneSource;
  family: DaemonLaneFamily;
};

const PATH_GLOBAL_OPTIONS = ["--session", "--agent-id", "--workspace", "--output-shape"] as const;
const OPEN_OPTIONS_WITH_VALUES = [
  "--profile",
  "--reuse",
  "--download-out-dir",
  "--wait-until",
  "--assert-url-prefix",
  "--assert-selector",
  "--assert-text",
  "--browser-mode",
  "--isolation",
  "--ensure-session",
  "--timeout-ms",
  "--fields",
] as const;
const OPEN_FLAG_OPTIONS = ["--allow-download", "--proof"] as const;

function validOptionValue(argv: string[], optionName: string): string | null {
  const parsed = parseGlobalOptionValue(argv, optionName);
  if (!parsed.found || !parsed.valid || typeof parsed.value !== "string") {
    return null;
  }
  const trimmed = parsed.value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashOriginToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function commandFamily(argv: string[]): DaemonLaneFamily {
  const [first, second] = resolveArgvCommandPath(argv);
  if (first === "open") {
    return "open";
  }
  if (first === "run") {
    return "run";
  }
  if (first === "session" && second === "attach") {
    return "session.attach";
  }
  if (first === "target") {
    return "target";
  }
  return "control";
}

function commandStartIndex(argv: string[]): number {
  let index = 2;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    let consumed = 0;
    for (const optionName of PATH_GLOBAL_OPTIONS) {
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
    return index;
  }
  return -1;
}

function firstOpenInputToken(argv: string[]): string | null {
  const start = commandStartIndex(argv);
  if (start < 0 || argv[start] !== "open") {
    return null;
  }
  for (let index = start + 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      break;
    }
    if (!token.startsWith("-")) {
      return token;
    }
    let consumed = 0;
    for (const optionName of OPEN_OPTIONS_WITH_VALUES) {
      consumed = parseOptionTokenSpan(argv, index, optionName);
      if (consumed > 0) {
        break;
      }
    }
    if (consumed > 0) {
      index += consumed - 1;
      continue;
    }
    if (OPEN_FLAG_OPTIONS.includes(token as (typeof OPEN_FLAG_OPTIONS)[number])) {
      continue;
    }
  }
  return null;
}

function openOriginLaneKey(argv: string[]): string | null {
  const input = firstOpenInputToken(argv);
  if (!input) {
    return null;
  }
  try {
    const parsed = new URL(input);
    return `origin:url:${hashOriginToken(parsed.origin.toLowerCase())}`;
  } catch {
    return `origin:urltoken:${hashOriginToken(input.toLowerCase())}`;
  }
}

function controlLaneKey(argv: string[]): string {
  const agentId = validOptionValue(argv, "--agent-id");
  if (!agentId) {
    return DAEMON_CONTROL_LANE_KEY;
  }
  return `control:agent:${hashOriginToken(agentId.toLowerCase())}`;
}

export function resolveDaemonLaneKey(opts: { argv: string[] }): DaemonLaneResolution {
  const family = commandFamily(opts.argv);

  const sessionId = validOptionValue(opts.argv, "--session") ?? validOptionValue(opts.argv, "--session-id");
  if (sessionId) {
    return {
      laneKey: `session:${sessionId}`,
      source: "sessionId",
      family,
    };
  }

  const cdp = validOptionValue(opts.argv, "--cdp");
  if (family === "session.attach" && cdp) {
    return {
      laneKey: `origin:${hashOriginToken(cdp)}`,
      source: "cdpOrigin",
      family,
    };
  }

  const profile = validOptionValue(opts.argv, "--profile");
  if ((family === "open" || family === "run") && profile) {
    return {
      laneKey: `origin:profile:${profile.toLowerCase()}`,
      source: "cdpOrigin",
      family,
    };
  }

  const isolation = validOptionValue(opts.argv, "--isolation");
  if ((family === "open" || family === "run") && isolation?.toLowerCase() === "shared") {
    return {
      laneKey: "origin:shared",
      source: "cdpOrigin",
      family,
    };
  }

  if (family === "open") {
    const openLane = openOriginLaneKey(opts.argv);
    if (openLane) {
      return {
        laneKey: openLane,
        source: "cdpOrigin",
        family,
      };
    }
  }

  return {
    laneKey: controlLaneKey(opts.argv),
    source: "control",
    family,
  };
}
