import type { CliCommandContract } from "../../core/types.js";

export const targetCommandManifest: CliCommandContract[] = [
  {
    id: "target.list",
    usage:
      "surfwright target list [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "list current page targets with explicit target handles",
  },
  {
    id: "target.snapshot",
    usage:
      "surfwright target snapshot <targetId> [--selector <query>] [--visible-only] [--frame-scope <scope>] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "read bounded text and UI primitives for a target",
  },
  {
    id: "target.find",
    usage:
      "surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--first] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "find matching elements by text or selector in a target",
  },
  {
    id: "target.click",
    usage:
      "surfwright target click <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--wait-for-text <text> | --wait-for-selector <query> | --wait-network-idle] [--snapshot] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "click the first matching element in a target",
  },
  {
    id: "target.fill",
    usage:
      "surfwright target fill <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] --value <text> [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "fill the first matching form control in a target",
  },
  {
    id: "target.form-fill",
    usage:
      "surfwright target form-fill <targetId> (--fields-json <json> | --fields-file <path>) [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "fill multiple form controls in one deterministic command",
  },
  {
    id: "target.hover",
    usage:
      "surfwright target hover <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--properties <csv>] [--settle-ms <ms>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "hover the first matching element and return compact style diffs",
  },
  {
    id: "target.read",
    usage:
      "surfwright target read <targetId> [--selector <query>] [--visible-only] [--frame-scope <scope>] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "read target text in deterministic chunks",
  },
  {
    id: "target.extract",
    usage:
      "surfwright target extract <targetId> [--kind <kind>] [--selector <query>] [--visible-only] [--frame-scope <scope>] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "extract structured content records (blog/news/docs/generic) from a target",
  },
  {
    id: "target.eval",
    usage:
      "surfwright target eval <targetId> (--expression <js> | --js <js> | --script <js> | --script-file <path>) [--arg-json <json>] [--capture-console] [--max-console <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "execute bounded JavaScript in page context for a target",
  },
  {
    id: "target.observe",
    usage:
      "surfwright target observe <targetId> --selector <query> [--contains <text>] [--visible-only] [--property <name>] [--interval-ms <ms>] [--duration-ms <ms>] [--max-samples <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "capture bounded time-series samples for a selector property on a target",
  },
  {
    id: "target.motion-detect",
    usage:
      "surfwright target motion-detect <targetId> --selector <query> [--contains <text>] [--visible-only] [--property <name>] [--interval-ms <ms>] [--duration-ms <ms>] [--max-samples <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "detect autonomous property motion for a selector over a bounded window",
  },
  {
    id: "target.scroll-plan",
    usage:
      "surfwright target scroll-plan <targetId> [--steps <csv>] [--settle-ms <ms>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "execute deterministic scroll steps and report requested vs achieved positions",
  },
  {
    id: "target.scroll-sample",
    usage:
      "surfwright target scroll-sample <targetId> --selector <query> [--contains <text>] [--visible-only] [--property <name>] [--steps <csv>] [--settle-ms <ms>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "execute deterministic scroll steps and sample selector property values at each step",
  },
  {
    id: "target.scroll-watch",
    usage:
      "surfwright target scroll-watch <targetId> --selector <query> [--contains <text>] [--visible-only] [--properties <csv>] [--steps <csv>] [--settle-ms <ms>] [--max-events <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "watch class/computed-style deltas and transition events while running a scroll plan",
  },
  {
    id: "target.scroll-reveal-scan",
    usage:
      "surfwright target scroll-reveal-scan <targetId> [--selector <query>] [--contains <text>] [--visible-only] [--max-candidates <n>] [--steps <csv>] [--settle-ms <ms>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "scan reveal-style candidates across scroll steps and report before/after deltas",
  },
  {
    id: "target.sticky-check",
    usage:
      "surfwright target sticky-check <targetId> [--selector <query>] [--contains <text>] [--visible-only] [--steps <csv>] [--settle-ms <ms>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "assert sticky behavior with deterministic scroll evidence",
  },
  {
    id: "target.transition-assert",
    usage:
      "surfwright target transition-assert <targetId> [--cycles <n>] [--capture-ms <ms>] [--max-events <n>] [--click-text <query> | --click-selector <query>] [--contains <text>] [--visible-only] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "run repeated trigger cycles and assert transition/animation event evidence",
  },
  {
    id: "target.transition-trace",
    usage:
      "surfwright target transition-trace <targetId> [--capture-ms <ms>] [--max-events <n>] [--click-text <query> | --click-selector <query>] [--contains <text>] [--visible-only] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "capture transition/animation events over a bounded window with optional click trigger",
  },
  {
    id: "target.wait",
    usage:
      "surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "wait for deterministic readiness condition on a target",
  },
  {
    id: "target.prune",
    usage: "surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--json] [--pretty]",
    summary: "prune stale/orphan target metadata with age and size caps",
  },
  {
    id: "target.console-tail",
    usage:
      "surfwright target console-tail <targetId> [--capture-ms <ms>] [--max-events <n>] [--levels <csv>] [--reload] [--timeout-ms <ms>] [--session <id>]",
    summary: "stream live console/pageerror/requestfailed events as NDJSON",
  },
  {
    id: "target.health",
    usage: "surfwright target health <targetId> [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "return target diagnostics with readiness checks and hints",
  },
  {
    id: "target.hud",
    usage: "surfwright target hud <targetId> [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]",
    summary: "return compact operator HUD payload for fast triage",
  },
];

export function targetCommandMeta(id: string): CliCommandContract {
  const found = targetCommandManifest.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing target command manifest entry: ${id}`);
  }
  return found;
}
