import type { CliCommandContract } from "../../../core/types.js";

export const expEffectsCommandManifest: CliCommandContract[] = [
  {
    id: "exp.effects",
    usage:
      "surfwright exp effects <targetId> [--profile <preset>] [--include-declared] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "experimental scaffold for effect observation and coverage reporting",
  },
];

export function expEffectsCommandMeta(id: string): CliCommandContract {
  const found = expEffectsCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing experimental command manifest entry: ${id}`);
  }
  return found;
}
