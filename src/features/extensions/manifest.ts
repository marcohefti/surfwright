import type { CliCommandContract } from "../../core/types.js";

export const extensionCommandManifest: CliCommandContract[] = [
  {
    id: "extension.load",
    usage: "surfwright extension load <path> [--json] [--pretty] [--session <id>]",
    summary: "register unpacked extension metadata with typed headless capability/fallback info",
  },
  {
    id: "extension.list",
    usage: "surfwright extension list [--json] [--pretty]",
    summary: "list registered extension metadata",
  },
  {
    id: "extension.reload",
    usage: "surfwright extension reload <extensionRef> [--json] [--pretty] [--session <id>]",
    summary: "mark a registered extension as reloaded and enabled",
  },
  {
    id: "extension.uninstall",
    usage: "surfwright extension uninstall <extensionRef> [--json] [--pretty] [--session <id>]",
    summary: "remove a registered extension entry",
  },
];

export function extensionCommandMeta(id: string): CliCommandContract {
  const found = extensionCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing extension command manifest entry: ${id}`);
  }
  return found;
}
