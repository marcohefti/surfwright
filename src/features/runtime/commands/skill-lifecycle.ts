import type { Command } from "commander";
import { getCliContractReport } from "../../../core/cli-contract.js";
import { skillDoctor, skillInstall, skillUpdate } from "../../../core/skills/manager.js";
import { runtimeCommandMeta } from "../manifest.js";

type RuntimeOutputOpts = {
  json: boolean;
  pretty: boolean;
};

type SkillLifecycleContext = {
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

export function registerSkillLifecycleCommands(ctx: SkillLifecycleContext): void {
  const skill = ctx.program.command("skill").description("Skill lifecycle commands");

  skill
    .command("install")
    .description(runtimeCommandMeta("skill.install").summary)
    .option("--source <path>", "Skill source directory")
    .option("--dest <path>", "Destination skill directory")
    .option("--lock <path>", "Skill lock file path")
    .action(async (options: { source?: string; dest?: string; lock?: string }) => {
      const output = ctx.globalOutputOpts();
      try {
        const contract = getCliContractReport(ctx.readPackageVersion());
        const report = await skillInstall({
          source: options.source,
          destination: options.dest,
          lockPath: options.lock,
          contract: {
            version: contract.version,
            contractSchemaVersion: contract.contractSchemaVersion,
            contractFingerprint: contract.contractFingerprint,
          },
        });
        printGenericSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  skill
    .command("doctor")
    .description(runtimeCommandMeta("skill.doctor").summary)
    .option("--dest <path>", "Destination skill directory")
    .option("--lock <path>", "Skill lock file path")
    .action(async (options: { dest?: string; lock?: string }) => {
      const output = ctx.globalOutputOpts();
      try {
        const contract = getCliContractReport(ctx.readPackageVersion());
        const report = await skillDoctor({
          destination: options.dest,
          lockPath: options.lock,
          contract: {
            version: contract.version,
            contractSchemaVersion: contract.contractSchemaVersion,
            contractFingerprint: contract.contractFingerprint,
          },
        });
        printGenericSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });

  skill
    .command("update")
    .description(runtimeCommandMeta("skill.update").summary)
    .option("--source <path>", "Skill source directory")
    .option("--dest <path>", "Destination skill directory")
    .option("--lock <path>", "Skill lock file path")
    .action(async (options: { source?: string; dest?: string; lock?: string }) => {
      const output = ctx.globalOutputOpts();
      try {
        const contract = getCliContractReport(ctx.readPackageVersion());
        const report = await skillUpdate({
          source: options.source,
          destination: options.dest,
          lockPath: options.lock,
          contract: {
            version: contract.version,
            contractSchemaVersion: contract.contractSchemaVersion,
            contractFingerprint: contract.contractFingerprint,
          },
        });
        printGenericSuccess(report, output);
      } catch (error) {
        ctx.handleFailure(error, output);
      }
    });
}
