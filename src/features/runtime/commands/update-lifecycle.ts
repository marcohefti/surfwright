import type { Command } from "commander";
import { updateCheck, updateRollback, updateRun } from "../../../core/update/public.js";
import { runtimeCommandMeta } from "../manifest.js";

type RuntimeOutputOpts = {
  json: boolean;
  pretty: boolean;
};

type UpdateLifecycleContext = {
  program: Command;
  globalOutputOpts: () => RuntimeOutputOpts;
  handleFailure: (error: unknown, outputOpts: RuntimeOutputOpts) => void;
  readPackageVersion: () => string;
};

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printGenericSuccess(report: Record<string, unknown>, opts: RuntimeOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }
  process.stdout.write("ok\n");
}

function parseBooleanFlag(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error("expected boolean value: true|false");
}

export function registerUpdateLifecycleCommands(ctx: UpdateLifecycleContext): void {
  const update = ctx.program.command("update").description("CLI update lifecycle commands");

  update
    .command("check")
    .description(runtimeCommandMeta("update.check").summary)
    .option("--package <name>", "Package name to resolve (default: @marcohefti/surfwright)")
    .option("--channel <channel>", "Update channel: stable|beta|dev")
    .option("--policy <policy>", "Update policy: manual|pinned|safe-patch")
    .option("--pinned-version <x.y.z>", "Pinned version when policy=pinned")
    .option("--check-on-start <true|false>", "Override update.checkOnStart for this command", parseBooleanFlag)
    .action(
      async (options: {
        package?: string;
        channel?: "stable" | "beta" | "dev";
        policy?: "manual" | "pinned" | "safe-patch";
        pinnedVersion?: string;
        checkOnStart?: boolean;
      }) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = await updateCheck({
            currentVersion: ctx.readPackageVersion(),
            packageName: options.package,
            channel: options.channel,
            policy: options.policy,
            pinnedVersion: options.pinnedVersion,
            checkOnStart: options.checkOnStart,
          });
          printGenericSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );

  update
    .command("run")
    .description(runtimeCommandMeta("update.run").summary)
    .option("--package <name>", "Package name to install (default: @marcohefti/surfwright)")
    .option("--channel <channel>", "Update channel: stable|beta|dev")
    .option("--policy <policy>", "Update policy: manual|pinned|safe-patch")
    .option("--pinned-version <x.y.z>", "Pinned version when policy=pinned")
    .option("--check-on-start <true|false>", "Override update.checkOnStart for this command", parseBooleanFlag)
    .option("--dry-run", "Run preflight and compatibility checks without applying", false)
    .action(
      async (options: {
        package?: string;
        channel?: "stable" | "beta" | "dev";
        policy?: "manual" | "pinned" | "safe-patch";
        pinnedVersion?: string;
        checkOnStart?: boolean;
        dryRun?: boolean;
      }) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = await updateRun({
            currentVersion: ctx.readPackageVersion(),
            cliPath: process.argv[1] ?? "dist/cli.js",
            packageName: options.package,
            channel: options.channel,
            policy: options.policy,
            pinnedVersion: options.pinnedVersion,
            checkOnStart: options.checkOnStart,
            dryRun: Boolean(options.dryRun),
          });
          printGenericSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );

  update
    .command("rollback")
    .description(runtimeCommandMeta("update.rollback").summary)
    .option("--package <name>", "Package name to rollback (default: @marcohefti/surfwright)")
    .option("--dry-run", "Report rollback target without applying", false)
    .action(async (options: { package?: string; dryRun?: boolean }) => {
      const output = ctx.globalOutputOpts();
      try {
        const report = await updateRollback({
          currentVersion: ctx.readPackageVersion(),
          packageName: options.package,
          dryRun: Boolean(options.dryRun),
        });
        printGenericSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });
}
