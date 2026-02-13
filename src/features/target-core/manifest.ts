import type { CliCommandContract } from "../../core/types.js";

export const targetCommandManifest: CliCommandContract[] = [
  {
    id: "target.list",
    usage: "surfwright target list [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "list current page targets with explicit target handles",
  },
  {
    id: "target.snapshot",
    usage:
      "surfwright target snapshot <targetId> [--selector <query>] [--visible-only] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "read bounded text and UI primitives for a target",
  },
  {
    id: "target.find",
    usage:
      "surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--first] [--limit <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "find matching elements by text or selector in a target",
  },
  {
    id: "target.read",
    usage:
      "surfwright target read <targetId> [--selector <query>] [--visible-only] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "read target text in deterministic chunks",
  },
  {
    id: "target.wait",
    usage:
      "surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "wait for deterministic readiness condition on a target",
  },
  {
    id: "target.prune",
    usage: "surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--json] [--pretty]",
    summary: "prune stale/orphan target metadata with age and size caps",
  },
];

export function targetCommandMeta(id: string): CliCommandContract {
  const found = targetCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing target command manifest entry: ${id}`);
  }
  return found;
}
