import { parseCommandPath, parseGlobalOptionValue } from "../../../cli/options.js";

export const DAEMON_CONTROL_LANE_KEY = "control:default";

export type DaemonLaneSource = "sessionId" | "cdpOrigin" | "control";
export type DaemonLaneFamily = "open" | "run" | "session.attach" | "target" | "control";

export type DaemonLaneResolution = {
  laneKey: string;
  source: DaemonLaneSource;
  family: DaemonLaneFamily;
};

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
  const [first, second] = parseCommandPath(argv);
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

export function resolveDaemonLaneKey(opts: { argv: string[] }): DaemonLaneResolution {
  const family = commandFamily(opts.argv);

  const sessionId = validOptionValue(opts.argv, "--session");
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

  return {
    laneKey: DAEMON_CONTROL_LANE_KEY,
    source: "control",
    family,
  };
}
