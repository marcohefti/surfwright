import type { CliCommandContract } from "../types.js";

export const baseCommandContracts: CliCommandContract[] = [
  {
    id: "doctor",
    usage: "surfwright doctor [--json] [--pretty]",
    summary: "check node/chrome prerequisites without side effects",
  },
  {
    id: "contract",
    usage: "surfwright contract [--json] [--pretty]",
    summary: "emit machine-readable CLI contract and error codes",
  },
  {
    id: "session.ensure",
    usage: "surfwright session ensure [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "reuse active session if reachable; otherwise use managed default",
  },
  {
    id: "session.new",
    usage: "surfwright session new [--session-id <id>] [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "create a managed browser session and mark it active",
  },
  {
    id: "session.attach",
    usage: "surfwright session attach --cdp <origin> [--session-id <id>] [--json] [--pretty]",
    summary: "explicitly attach to an already running CDP endpoint",
  },
  {
    id: "session.use",
    usage: "surfwright session use <sessionId> [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "switch active session after reachability check",
  },
  {
    id: "session.list",
    usage: "surfwright session list [--json] [--pretty]",
    summary: "list known sessions and current active pointer",
  },
  {
    id: "session.prune",
    usage: "surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "prune unreachable sessions and repair stale managed pid metadata",
  },
  {
    id: "open",
    usage: "surfwright open <url> [--reuse-url] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "open URL and return minimal page report with target handle",
  },
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
  {
    id: "state.reconcile",
    usage:
      "surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--json] [--pretty]",
    summary: "repair and prune state for resilient post-restart recovery",
  },
];
