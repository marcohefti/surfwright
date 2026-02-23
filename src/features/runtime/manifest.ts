import type { CliCommandContract } from "../../core/types.js";

export const runtimeCommandManifest: CliCommandContract[] = [
  {
    id: "doctor",
    usage: "surfwright doctor [--no-json] [--pretty]",
    summary: "check node/chrome prerequisites without side effects",
  },
  {
    id: "contract",
    usage: "surfwright contract [--search <term>] [--core] [--full] [--no-json] [--pretty]",
    summary: "emit machine-readable CLI contract metadata (compact by default)",
  },
  {
    id: "workspace.info",
    usage: "surfwright workspace info [--no-json] [--pretty]",
    summary: "show resolved project workspace (./.surfwright) for reusable profiles",
  },
  {
    id: "workspace.init",
    usage: "surfwright workspace init [--no-json] [--pretty]",
    summary: "create a project workspace (./.surfwright) with gitignored profile storage",
  },
  {
    id: "workspace.profile-locks",
    usage: "surfwright workspace profile-locks [--no-json] [--pretty]",
    summary: "list workspace profile lock files with staleness hints",
  },
  {
    id: "workspace.profile-lock-clear",
    usage: "surfwright workspace profile-lock-clear <profile> [--force] [--no-json] [--pretty]",
    summary: "clear a stale workspace profile lock (safe by default)",
  },
  {
    id: "session.ensure",
    usage: "surfwright session ensure [--browser-mode <headless|headed>] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "reuse active session if reachable; otherwise use managed default",
  },
  {
    id: "session.new",
    usage:
      "surfwright session new [--session-id <id>] [--browser-mode <headless|headed>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "create a managed browser session and mark it active",
  },
  {
    id: "session.fresh",
    usage:
      "surfwright session fresh [--session-id <id>] [--browser-mode <headless|headed>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "create a fresh ephemeral managed session and mark it active",
  },
  {
    id: "session.attach",
    usage:
      "surfwright session attach --cdp <origin> [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "explicitly attach to an already running CDP endpoint",
  },
  {
    id: "session.use",
    usage: "surfwright session use <sessionId> [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "switch active session after reachability check",
  },
  {
    id: "session.list",
    usage: "surfwright session list [--no-json] [--pretty]",
    summary: "list known sessions and current active pointer",
  },
  {
    id: "session.prune",
    usage: "surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "prune unreachable sessions and repair stale managed pid metadata",
  },
  {
    id: "session.clear",
    usage: "surfwright session clear [--keep-processes] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "clear all sessions and, by default, shut down associated browser processes",
  },
  {
    id: "session.cookie-copy",
    usage:
      "surfwright session cookie-copy --from-session <id> --to-session <id> --url <url> [--url <url> ...] [--timeout-ms <ms>] [--no-json] [--pretty]",
    summary: "copy scoped cookies from one reachable session to another",
  },
  {
    id: "open",
    usage:
      "surfwright open <url> [--profile <name>] [--reuse <off|url|origin|active>] [--allow-download] [--download-out-dir <path>] [--wait-until <commit|domcontentloaded|load|networkidle>] [--proof] [--assert-url-prefix <prefix>] [--assert-selector <query>] [--assert-text <text>] [--browser-mode <headless|headed>] [--isolation <mode>] [--ensure-session <off|if-missing|fresh>] [--timeout-ms <ms>] [--fields <csv>] [--no-json] [--pretty] [--session <id>]",
    summary: "open URL and return minimal page report with target handle",
  },
  {
    id: "state.reconcile",
    usage:
      "surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--no-json] [--pretty]",
    summary: "repair and prune state for resilient post-restart recovery",
  },
  {
    id: "state.disk-prune",
    usage:
      "surfwright state disk-prune [--runs-max-age-hours <h>] [--runs-max-total-mb <n>] [--captures-max-age-hours <h>] [--captures-max-total-mb <n>] [--orphan-profiles-max-age-hours <h>] [--workspace-profiles-max-age-hours <h>] [--dry-run] [--no-json] [--pretty]",
    summary: "prune run/capture/profile disk usage with bounded retention policies",
  },
  {
    id: "run",
    usage:
      "surfwright run [--plan <path>|--plan-json <json>|--replay <path>] [--doctor] [--record] [--record-path <path>] [--record-label <label>] [--log-ndjson <path>] [--log-mode <minimal|full>] [--profile <name>] [--browser-mode <headless|headed>] [--isolation <mode>] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]",
    summary: "execute, lint, record, or replay deterministic multi-step browser plans",
  },
  {
    id: "update.check",
    usage:
      "surfwright update check [--package <name>] [--channel <stable|beta|dev>] [--policy <manual|pinned|safe-patch>] [--pinned-version <x.y.z>] [--check-on-start <true|false>] [--no-json] [--pretty]",
    summary: "check available CLI updates with channel/policy-aware preflight",
  },
  {
    id: "update.run",
    usage:
      "surfwright update run [--package <name>] [--channel <stable|beta|dev>] [--policy <manual|pinned|safe-patch>] [--pinned-version <x.y.z>] [--check-on-start <true|false>] [--dry-run] [--no-json] [--pretty]",
    summary: "apply CLI update via authoritative update pipeline with doctor verification",
  },
  {
    id: "update.rollback",
    usage: "surfwright update rollback [--package <name>] [--dry-run] [--no-json] [--pretty]",
    summary: "rollback CLI to previous known-good version from update history",
  },
  {
    id: "skill.install",
    usage:
      "surfwright skill install [--source <path>] [--dest <path>] [--lock <path>] [--no-json] [--pretty]",
    summary: "install skill atomically with contract compatibility gates",
  },
  {
    id: "skill.doctor",
    usage: "surfwright skill doctor [--dest <path>] [--lock <path>] [--no-json] [--pretty]",
    summary: "report installed skill health, compatibility, and lock drift",
  },
  {
    id: "skill.update",
    usage:
      "surfwright skill update [--source <path>] [--dest <path>] [--lock <path>] [--no-json] [--pretty]",
    summary: "update skill atomically with compatibility checks and rollback safety",
  },
];

export function runtimeCommandMeta(id: string): CliCommandContract {
  const found = runtimeCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing runtime command manifest entry: ${id}`);
  }
  return found;
}
