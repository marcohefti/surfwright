import type { CliContractReport } from "./types.js";

export function getCliContractReport(version: string): CliContractReport {
  return {
    ok: true,
    name: "surfwright",
    version,
    guarantees: [
      "deterministic output shape",
      "typed failures (code + message)",
      "json compact by default",
      "explicit handles for sessions and targets",
      "bounded runtime via explicit timeouts",
    ],
    commands: [
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
        id: "target.network",
        usage:
          "surfwright target network <targetId> [--action-id <id>] [--profile <preset>] [--view <mode>] [--fields <csv>] [--capture-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--include-headers] [--include-post-data] [--no-ws-messages] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "capture bounded network/websocket diagnostics and performance summary for a target",
      },
      {
        id: "target.network-tail",
        usage:
          "surfwright target network-tail <targetId> [--action-id <id>] [--profile <preset>] [--capture-ms <ms>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--session <id>]",
        summary: "stream live network/websocket events as NDJSON for short capture windows",
      },
      {
        id: "target.network-query",
        usage:
          "surfwright target network-query [--capture-id <id> | --artifact-id <id>] [--preset <name>] [--limit <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--json] [--pretty]",
        summary: "query saved network captures/artifacts with high-signal presets",
      },
      {
        id: "target.network-export",
        usage:
          "surfwright target network-export <targetId> --out <path> [--action-id <id>] [--format har] [--profile <preset>] [--capture-ms <ms>] [--max-requests <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "export filtered network capture as artifact (har)",
      },
      {
        id: "target.network-export-list",
        usage: "surfwright target network-export-list [--limit <n>] [--json] [--pretty]",
        summary: "list indexed network export artifacts",
      },
      {
        id: "target.network-export-prune",
        usage:
          "surfwright target network-export-prune [--max-age-hours <h>] [--max-count <n>] [--max-total-mb <n>] [--keep-files] [--json] [--pretty]",
        summary: "prune indexed export artifacts by retention policy",
      },
      {
        id: "target.network-begin",
        usage:
          "surfwright target network-begin <targetId> [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--include-headers] [--include-post-data] [--no-ws-messages] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "start handle-based background network capture for an action window",
      },
      {
        id: "target.network-end",
        usage:
          "surfwright target network-end <captureId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--json] [--pretty]",
        summary: "stop background capture handle and return projected analysis report",
      },
      {
        id: "target.network-check",
        usage:
          "surfwright target network-check [targetId] --budget <path> [--capture-id <id>] [--artifact-id <id>] [--profile <preset>] [--capture-ms <ms>] [--fail-on-violation] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]",
        summary: "evaluate network metrics against budget thresholds",
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
    ],
    errors: [
      { code: "E_URL_INVALID", message: "URL must be absolute (e.g. https://example.com)", retryable: false },
      { code: "E_SESSION_ID_INVALID", message: "sessionId may only contain letters, numbers, dot, underscore, and dash", retryable: false },
      { code: "E_SESSION_NOT_FOUND", message: "Requested session was not found in state", retryable: false },
      { code: "E_SESSION_EXISTS", message: "Session id already exists", retryable: false },
      { code: "E_SESSION_UNREACHABLE", message: "Attached session endpoint is not reachable", retryable: true },
      { code: "E_SESSION_CONFLICT", message: "Reserved default session id has conflicting kind", retryable: false },
      { code: "E_TARGET_ID_INVALID", message: "targetId contains invalid characters", retryable: false },
      { code: "E_TARGET_NOT_FOUND", message: "Requested target was not found in session", retryable: false },
      { code: "E_QUERY_INVALID", message: "Query input is invalid or missing", retryable: false },
      { code: "E_SELECTOR_INVALID", message: "Selector query is invalid", retryable: false },
      { code: "E_CDP_INVALID", message: "CDP URL is invalid", retryable: false },
      { code: "E_CDP_UNREACHABLE", message: "CDP endpoint is not reachable", retryable: true },
      { code: "E_BROWSER_NOT_FOUND", message: "No compatible Chrome/Chromium binary found", retryable: false },
      { code: "E_BROWSER_START_FAILED", message: "Chrome/Chromium process failed to start", retryable: true },
      { code: "E_BROWSER_START_TIMEOUT", message: "CDP endpoint did not become ready in time", retryable: true },
      { code: "E_STATE_LOCK_TIMEOUT", message: "Timed out waiting for state lock", retryable: true },
      { code: "E_STATE_LOCK_IO", message: "State lock file I/O failed", retryable: true },
      { code: "E_INTERNAL", message: "Unexpected runtime failure", retryable: true },
    ],
  };
}
