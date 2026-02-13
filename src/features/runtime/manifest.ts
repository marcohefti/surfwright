import type { CliCommandContract } from "../../core/types.js";

export const runtimeCommandManifest: CliCommandContract[] = [
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
    usage:
      "surfwright session new [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "create a managed browser session and mark it active",
  },
  {
    id: "session.fresh",
    usage:
      "surfwright session fresh [--session-id <id>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]",
    summary: "create a fresh ephemeral managed session and mark it active",
  },
  {
    id: "session.attach",
    usage:
      "surfwright session attach --cdp <origin> [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]",
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
    usage:
      "surfwright open <url> [--reuse-url] [--isolation <mode>] [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "open URL and return minimal page report with target handle",
  },
  {
    id: "state.reconcile",
    usage:
      "surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--json] [--pretty]",
    summary: "repair and prune state for resilient post-restart recovery",
  },
  {
    id: "run",
    usage:
      "surfwright run [--plan <path>|--plan-json <json>|--replay <path>] [--doctor] [--record] [--record-path <path>] [--record-label <label>] [--isolation <mode>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
    summary: "execute, lint, record, or replay deterministic multi-step browser plans",
  },
];

export function runtimeCommandMeta(id: string): CliCommandContract {
  const found = runtimeCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing runtime command manifest entry: ${id}`);
  }
  return found;
}
