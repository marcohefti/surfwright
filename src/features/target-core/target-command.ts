import type { Command } from "commander";

const TARGET_COMMAND_DESCRIPTION = "Inspect browser targets in a session";

export function ensureTargetCommand(program: Command): Command {
  const existing = program.commands.find((entry) => entry.name() === "target");
  if (existing) {
    return existing;
  }
  return program.command("target").description(TARGET_COMMAND_DESCRIPTION);
}
