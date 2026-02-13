import type { Command } from "commander";
import type { CliCommandContract } from "../core/types.js";
import { expEffectsCommandManifest, registerExpEffectsCommands } from "./experimental/effects/index.js";
import { networkCommandManifest } from "./network/manifest.js";
import { registerNetworkCommands } from "./network/register-commands.js";
import { runtimeCommandManifest } from "./runtime/manifest.js";
import { registerRuntimeCommands } from "./runtime/register-commands.js";
import { targetCommandManifest } from "./target-core/manifest.js";
import { registerTargetCommands } from "./target-core/register-commands.js";

export type FeatureOutputOpts = {
  json: boolean;
  pretty: boolean;
};

export type FeatureRegistryContext = {
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => FeatureOutputOpts;
  handleFailure: (error: unknown, outputOpts: FeatureOutputOpts) => void;
  readPackageVersion: () => string;
};

export type FeaturePlugin = {
  id: string;
  stability: "stable" | "experimental";
  commands: CliCommandContract[];
  register: (ctx: FeatureRegistryContext) => void;
};

export const stableFeaturePlugins: FeaturePlugin[] = [
  {
    id: "runtime",
    stability: "stable",
    commands: runtimeCommandManifest,
    register: (ctx) =>
      registerRuntimeCommands({
        program: ctx.program,
        parseTimeoutMs: ctx.parseTimeoutMs,
        globalOutputOpts: ctx.globalOutputOpts,
        handleFailure: ctx.handleFailure,
        readPackageVersion: ctx.readPackageVersion,
      }),
  },
  {
    id: "target-core",
    stability: "stable",
    commands: targetCommandManifest,
    register: (ctx) =>
      registerTargetCommands({
        program: ctx.program,
        parseTimeoutMs: ctx.parseTimeoutMs,
        globalOutputOpts: ctx.globalOutputOpts,
        handleFailure: ctx.handleFailure,
      }),
  },
  {
    id: "network",
    stability: "stable",
    commands: networkCommandManifest,
    register: (ctx) =>
      registerNetworkCommands({
        program: ctx.program,
        parseTimeoutMs: ctx.parseTimeoutMs,
        globalOutputOpts: ctx.globalOutputOpts,
        handleFailure: ctx.handleFailure,
      }),
  },
];

export const experimentalFeaturePlugins: FeaturePlugin[] = [
  {
    id: "exp-effects",
    stability: "experimental",
    commands: expEffectsCommandManifest,
    register: (ctx) =>
      registerExpEffectsCommands({
        program: ctx.program,
        parseTimeoutMs: ctx.parseTimeoutMs,
        globalOutputOpts: ctx.globalOutputOpts,
        handleFailure: ctx.handleFailure,
      }),
  },
];

export const allFeaturePlugins: FeaturePlugin[] = [...stableFeaturePlugins, ...experimentalFeaturePlugins];

export const allCommandManifest: CliCommandContract[] = allFeaturePlugins.flatMap((plugin) => plugin.commands);

export function registerFeaturePlugins(ctx: FeatureRegistryContext): void {
  for (const plugin of allFeaturePlugins) {
    plugin.register(ctx);
  }
}
