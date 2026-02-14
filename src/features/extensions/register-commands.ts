import type { Command } from "commander";
import { extensionList, extensionLoad, extensionReload, extensionUninstall } from "../../core/usecases.js";
import { extensionCommandMeta } from "./manifest.js";

type RegisterExtensionCommandsOptions = {
  program: Command;
  globalOutputOpts: () => { json: boolean; pretty: boolean };
  handleFailure: (error: unknown, output: { json: boolean; pretty: boolean }) => void;
};

function printExtensionSuccess(report: unknown, output: { json: boolean; pretty: boolean }) {
  if (output.json || output.pretty) {
    const spacing = output.pretty ? 2 : 0;
    process.stdout.write(`${JSON.stringify(report, null, spacing)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function ensureExtensionCommand(program: Command): Command {
  const existing = program.commands.find((command) => command.name() === "extension");
  if (existing) {
    return existing;
  }
  return program.command("extension").description("Extension lifecycle controls with typed capability metadata");
}

export function registerExtensionCommands(opts: RegisterExtensionCommandsOptions) {
  const extension = ensureExtensionCommand(opts.program);
  const loadMeta = extensionCommandMeta("extension.load");
  extension
    .command("load")
    .description(loadMeta.summary)
    .argument("<path>", "Absolute or relative extension directory path containing manifest.json")
    .action((extensionPath: string) => {
      const output = opts.globalOutputOpts();
      const globalOpts = opts.program.opts<{ session?: string }>();
      try {
        printExtensionSuccess(
          extensionLoad({
            extensionPath,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
          }),
          output,
        );
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });

  const listMeta = extensionCommandMeta("extension.list");
  extension
    .command("list")
    .description(listMeta.summary)
    .action(() => {
      const output = opts.globalOutputOpts();
      try {
        printExtensionSuccess(extensionList(), output);
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });

  const reloadMeta = extensionCommandMeta("extension.reload");
  extension
    .command("reload")
    .description(reloadMeta.summary)
    .argument("<extensionRef>", "Extension id or exact extension name")
    .option("--fail-if-missing", "Return typed failure when extensionRef is not registered")
    .action((extensionRef: string, commandOptions: { failIfMissing?: boolean }) => {
      const output = opts.globalOutputOpts();
      const globalOpts = opts.program.opts<{ session?: string }>();
      try {
        printExtensionSuccess(
          extensionReload({
            extensionRef,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            failIfMissing: Boolean(commandOptions.failIfMissing),
          }),
          output,
        );
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });

  const uninstallMeta = extensionCommandMeta("extension.uninstall");
  extension
    .command("uninstall")
    .description(uninstallMeta.summary)
    .argument("<extensionRef>", "Extension id or exact extension name")
    .option("--fail-if-missing", "Return typed failure when extensionRef is not registered")
    .action((extensionRef: string, commandOptions: { failIfMissing?: boolean }) => {
      const output = opts.globalOutputOpts();
      const globalOpts = opts.program.opts<{ session?: string }>();
      try {
        printExtensionSuccess(
          extensionUninstall({
            extensionRef,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            failIfMissing: Boolean(commandOptions.failIfMissing),
          }),
          output,
        );
      } catch (error) {
        opts.handleFailure(error, output);
      }
    });
}
