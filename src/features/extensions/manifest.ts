import type { CliCommandContract } from "../../core/types.js";

export const extensionCommandManifest: CliCommandContract[] = [
  {
    id: "extension.load",
    usage: "surfwright extension load <path> [--no-json] [--pretty] [--session <id>]",
    summary: "register unpacked extension build for deterministic managed session mounting",
  },
  {
    id: "extension.list",
    usage: "surfwright extension list [--no-json] [--pretty]",
    summary: "list registered extensions with build and set fingerprints",
  },
  {
    id: "extension.reload",
    usage: "surfwright extension reload <extensionRef> [--fail-if-missing] [--no-json] [--pretty] [--session <id>]",
    summary: "refresh extension build fingerprint and mark it enabled (idempotent when missing)",
  },
  {
    id: "extension.uninstall",
    usage: "surfwright extension uninstall <extensionRef> [--fail-if-missing] [--no-json] [--pretty] [--session <id>]",
    summary: "remove a registered extension from the managed launch set",
  },
];

export function extensionCommandMeta(id: string): CliCommandContract {
  const found = extensionCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing extension command manifest entry: ${id}`);
  }
  return found;
}
