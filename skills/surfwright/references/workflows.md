# Workflows

## 1) Bootstrap and introspect surface

```bash
surfwright --json contract
surfwright --json doctor
```

Use `contract` output as source-of-truth for command ids, usage strings, and known error codes.

## 2) Default navigation loop

```bash
surfwright --json session ensure
surfwright --json open https://example.com --reuse-url
surfwright --json target list
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "query" --first --visible-only
surfwright --json target read <targetId> --selector main --chunk-size 1200 --chunk 1
surfwright --json target wait <targetId> --for-selector "h1"
surfwright --json target network <targetId> --capture-ms 2500 --status 2xx
surfwright --json target network <targetId> --reload --capture-ms 3000 --har-out ./artifacts/capture.har
```

- `session ensure` guarantees a reachable active session (or creates managed default).
- `open --reuse-url` reuses an existing matching URL target when available to avoid duplicate tabs.
- `target list` enumerates currently reachable page targets.
- `target snapshot` returns bounded text/headings/buttons/links for one explicit target.
- `target find` checks match counts and returns bounded match metadata for one explicit query.
- `target read` returns deterministic chunks for long text extraction.
- `target wait` blocks until text/selector/network-idle readiness is met.
- `target network` captures bounded request/websocket diagnostics with filterable performance summary.
- `target network --har-out <path>` writes a compact HAR artifact for deep offline inspection while keeping stdout JSON small.

## 3) Explicit session lifecycle

Create and pin a named managed session:

```bash
surfwright --json session new --session-id s-checkout
surfwright --json --session s-checkout open https://example.com
```

Attach to external Chrome endpoint:

```bash
surfwright --json session attach --cdp http://127.0.0.1:9222 --session-id a-login
surfwright --json session use a-login
```

List known sessions:

```bash
surfwright --json session list
```

## 4) Output rules

- Always parse JSON from stdout.
- Avoid `--pretty` in automated loops.
- Treat non-zero process exit as failure and decode `code` from JSON.
- Prefer `targetId` from `open` when taking snapshots; use `target list` only when recovering from lost handles.

## 5) State hygiene after restart/crash

Run this when the host restarts, Chrome dies unexpectedly, or `state.json` might contain stale entries:

```bash
surfwright --json session prune
surfwright --json target prune --max-age-hours 168 --max-per-session 200
```

Single-command equivalent:

```bash
surfwright --json state reconcile
```

- `session prune` removes unreachable attached sessions and repairs stale managed `browserPid`.
- `target prune` removes orphaned/aged targets and caps target history per session.
- `state reconcile` combines both reports in one deterministic response payload.
