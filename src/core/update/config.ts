import fs from "node:fs";
import path from "node:path";
import { stateRootDir } from "../state/index.js";

export type UpdateChannel = "stable" | "beta" | "dev";
export type UpdatePolicy = "manual" | "pinned" | "safe-patch";

export type RuntimeConfig = {
  update: {
    checkOnStart: boolean;
    channel: UpdateChannel;
    policy: UpdatePolicy;
    pinnedVersion: string | null;
  };
};

const DEFAULT_CONFIG: RuntimeConfig = {
  update: {
    checkOnStart: true,
    channel: "stable",
    policy: "manual",
    pinnedVersion: null,
  },
};

export function runtimeConfigPath(): string {
  return path.join(stateRootDir(), "config.json");
}

function normalizeConfig(raw: unknown): RuntimeConfig {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_CONFIG;
  }
  const value = raw as {
    update?: {
      checkOnStart?: unknown;
      channel?: unknown;
      policy?: unknown;
      pinnedVersion?: unknown;
    };
  };
  const update = value.update;
  const channel = update?.channel;
  const policy = update?.policy;
  return {
    update: {
      checkOnStart: typeof update?.checkOnStart === "boolean" ? update.checkOnStart : DEFAULT_CONFIG.update.checkOnStart,
      channel: channel === "stable" || channel === "beta" || channel === "dev" ? channel : DEFAULT_CONFIG.update.channel,
      policy:
        policy === "manual" || policy === "pinned" || policy === "safe-patch"
          ? policy
          : DEFAULT_CONFIG.update.policy,
      pinnedVersion: typeof update?.pinnedVersion === "string" && update.pinnedVersion.length > 0 ? update.pinnedVersion : null,
    },
  };
}

export function readRuntimeConfig(): RuntimeConfig {
  try {
    const configPath = runtimeConfigPath();
    const raw = fs.readFileSync(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeRuntimeConfig(config: RuntimeConfig): void {
  const normalized = normalizeConfig(config);
  const configPath = runtimeConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
