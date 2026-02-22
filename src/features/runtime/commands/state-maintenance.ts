import type { Command } from "commander";
import { stateDiskPrune, stateReconcile } from "../../../core/state/public.js";
import { DEFAULT_SESSION_TIMEOUT_MS, type CliCommandContract } from "../../../core/types.js";
import { printStateDiskPruneSuccess, printStateReconcileSuccess, type RuntimeOutputOpts } from "../printers.js";

type RegisterStateMaintenanceCommandsContext = {
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => RuntimeOutputOpts;
  handleFailure: (error: unknown, outputOpts: RuntimeOutputOpts) => void;
  reconcileMeta: CliCommandContract;
  diskPruneMeta: CliCommandContract;
};

export function registerStateMaintenanceCommands(ctx: RegisterStateMaintenanceCommandsContext): void {
  const state = ctx.program.command("state").description("State maintenance operations");

  state
    .command("reconcile")
    .description(ctx.reconcileMeta.summary)
    .option("--timeout-ms <ms>", "Session reachability timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS)
    .option("--max-age-hours <h>", "Maximum target age in hours to retain")
    .option("--max-per-session <n>", "Maximum retained targets per session")
    .option("--drop-managed-unreachable", "Remove managed sessions when currently unreachable", false)
    .action(
      async (options: {
        timeoutMs: number;
        maxAgeHours?: string;
        maxPerSession?: string;
        dropManagedUnreachable?: boolean;
      }) => {
        const output = ctx.globalOutputOpts();
        const maxAgeHours = typeof options.maxAgeHours === "string" ? Number.parseInt(options.maxAgeHours, 10) : undefined;
        const maxPerSession =
          typeof options.maxPerSession === "string" ? Number.parseInt(options.maxPerSession, 10) : undefined;
        try {
          const report = await stateReconcile({
            timeoutMs: options.timeoutMs,
            maxAgeHours,
            maxPerSession,
            dropManagedUnreachable: Boolean(options.dropManagedUnreachable),
          });
          printStateReconcileSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );

  state
    .command("disk-prune")
    .description(ctx.diskPruneMeta.summary)
    .option("--runs-max-age-hours <h>", "Delete run artifacts older than N hours")
    .option("--runs-max-total-mb <n>", "Keep run artifacts within total size budget (MB)")
    .option("--captures-max-age-hours <h>", "Delete capture artifacts older than N hours")
    .option("--captures-max-total-mb <n>", "Keep capture artifacts within total size budget (MB)")
    .option("--orphan-profiles-max-age-hours <h>", "Delete orphan session profiles older than N hours")
    .option(
      "--workspace-profiles-max-age-hours <h>",
      "Delete workspace profiles older than N hours (disabled unless explicitly set)",
    )
    .option("--dry-run", "Report what would be removed without deleting files", false)
    .action(
      async (options: {
        runsMaxAgeHours?: string;
        runsMaxTotalMb?: string;
        capturesMaxAgeHours?: string;
        capturesMaxTotalMb?: string;
        orphanProfilesMaxAgeHours?: string;
        workspaceProfilesMaxAgeHours?: string;
        dryRun?: boolean;
      }) => {
        const output = ctx.globalOutputOpts();
        try {
          const report = await stateDiskPrune({
            runsMaxAgeHours:
              typeof options.runsMaxAgeHours === "string" ? Number.parseInt(options.runsMaxAgeHours, 10) : undefined,
            runsMaxTotalBytes:
              typeof options.runsMaxTotalMb === "string" ? Number.parseInt(options.runsMaxTotalMb, 10) * 1024 * 1024 : undefined,
            capturesMaxAgeHours:
              typeof options.capturesMaxAgeHours === "string" ? Number.parseInt(options.capturesMaxAgeHours, 10) : undefined,
            capturesMaxTotalBytes:
              typeof options.capturesMaxTotalMb === "string"
                ? Number.parseInt(options.capturesMaxTotalMb, 10) * 1024 * 1024
                : undefined,
            orphanProfilesMaxAgeHours:
              typeof options.orphanProfilesMaxAgeHours === "string"
                ? Number.parseInt(options.orphanProfilesMaxAgeHours, 10)
                : undefined,
            workspaceProfilesMaxAgeHours:
              typeof options.workspaceProfilesMaxAgeHours === "string"
                ? Number.parseInt(options.workspaceProfilesMaxAgeHours, 10)
                : undefined,
            dryRun: Boolean(options.dryRun),
          });
          printStateDiskPruneSuccess(report, output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      },
    );
}
