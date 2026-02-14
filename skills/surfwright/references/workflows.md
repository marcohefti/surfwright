# Workflows

## 1) Bootstrap and introspect surface

```bash
surfwright --json contract
surfwright --json doctor
```

Use `contract` output as source-of-truth for command ids, usage strings, and known error codes.

## 2) Default navigation loop

```bash
surfwright --json open https://example.com
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "query" --first --visible-only
surfwright --json target click <targetId> --text "query" --visible-only
surfwright --json target fill <targetId> --selector "#email" --value "agent@example.com"
surfwright --json target form-fill <targetId> --fields-json '{"#email":"agent@example.com","#agree":true}'
surfwright --json target upload <targetId> --selector "input[type=file]" --file ./assets/avatar.png
surfwright --json target keypress <targetId> --key Enter --selector "input[name=search]"
surfwright --json target drag-drop <targetId> --from "#card-a" --to "#column-done"
surfwright --json target spawn <targetId> --selector "a[target=_blank]"
surfwright --json target close <targetId>
surfwright --json target dialog <targetId> --action accept --trigger-selector "#delete"
surfwright --json target emulate <targetId> --width 390 --height 844 --color-scheme dark --touch --device-scale-factor 2
surfwright --json target screenshot <targetId> --out ./artifacts/page.png --full-page
surfwright --json target console-get <targetId> --contains "PARITY_CONSOLE_SENTINEL_20260214" --capture-ms 1200
surfwright --json target read <targetId> --selector main --chunk-size 1200 --chunk 1
surfwright --json target eval <targetId> --js "console.log('hello from agent'); return document.title" --capture-console
surfwright --json target wait <targetId> --for-selector "h1"
surfwright --json target network <targetId> --profile perf --view summary
surfwright target network-tail <targetId> --profile api --capture-ms 3000
surfwright --json target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright --json target network-begin <targetId> --action-id checkout-click --profile api --max-runtime-ms 600000
surfwright --json target network-end <captureId> --view summary --status 5xx
surfwright --json target trace begin <targetId> --profile perf --max-runtime-ms 300000
surfwright --json target trace export --trace-id <traceId> --out ./artifacts/trace.json.gz --format json.gz
surfwright --json target trace insight <targetId> --capture-ms 2000
surfwright --json target network-export <targetId> --profile page --reload --capture-ms 3000 --out ./artifacts/capture.har
surfwright --json target network-export-list --limit 20
surfwright --json target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright --json target network-check <targetId> --budget ./budgets/network.json --profile perf --capture-ms 5000 --fail-on-violation
```

- `open` without `--session` creates a new isolated ephemeral session and returns `sessionId`, `sessionSource`, and `targetId`.
- `open --isolation shared` reuses shared managed session behavior when you need continuity across independent runs.
- `target *` without `--session` infers session from `targetId`; no active-session fallback is used.
- `target list` requires `--session` if no target-based inference is possible.
- `target snapshot` returns bounded text/headings/buttons/links for one explicit target.
- `target find` checks match counts and returns bounded match metadata for one explicit query.
- `target click` executes one explicit click action from text/selector query semantics.
- `target fill` executes one explicit form-control fill from text/selector query semantics.
- `target form-fill` applies multiple selector/value entries in one deterministic action.
- `target upload` supports direct file-input upload with deterministic filechooser fallback.
- `target keypress` sends one key input to page or a focused matched element.
- `target drag-drop` executes one selector-to-selector drag operation.
- `target spawn` returns a child `targetId` from a click that opens a new page/tab.
- `target close` closes an explicit target handle and returns typed closure confirmation.
- `target dialog` accepts/dismisses dialogs and can trigger the dialog source in one command.
- `target emulate` applies bounded viewport/device/UA/media emulation on an existing target.
- `target screenshot` captures deterministic artifact metadata (`path`, bytes, hash, dimensions).
- `target console-get` retrieves one structured console/pageerror/requestfailed event for tight assertion loops.
- `target read` returns deterministic chunks for long text extraction.
- `target eval` executes bounded JavaScript in page context and returns typed result projection.
- `target wait` blocks until text/selector/network-idle readiness is met.
- `target network` captures bounded request/websocket diagnostics with profiles, projections, hints, and insights.
- `target network-tail` streams NDJSON events for live request/socket observation.
- `target network-query` answers common diagnostics directly from saved capture/HAR sources.
- `target network-begin` / `target network-end` gives action-scoped handle capture around workflows.
- `target trace begin` / `target trace export` / `target trace insight` provide discoverable trace-first perf flows.
- `target network-export --out <path>` writes a compact HAR artifact for deep offline inspection.
- `target network-export-list` / `target network-export-prune` manage indexed artifacts with retention policies.
- `target network-check` compares runtime metrics against explicit budget files.

## 3) Explicit session lifecycle

Create and pin a named managed session:

```bash
surfwright --json session new --session-id s-checkout
surfwright --json --session s-checkout open https://example.com
```

Create a fresh ephemeral managed session in one command:

```bash
surfwright --json session fresh
```

Attach to external Chrome endpoint:

```bash
surfwright --json session attach --cdp http://127.0.0.1:9222 --session-id a-login
surfwright --json session use a-login
```

If `/json/version` is slow to respond on your endpoint, add `--timeout-ms <ms>` to `session attach`.

List known sessions:

```bash
surfwright --json session list
```

Copy scoped auth cookies from one explicit session to another:

```bash
surfwright --json session cookie-copy --from-session a-login --to-session s-checkout --url https://dashboard.stripe.com --url https://access.stripe.com
```

- `session cookie-copy` reads cookies visible for each provided `--url` from the source session, imports them into the destination session, and returns bounded metadata (counts + sampled names/domains only).
- Use multiple `--url` flags for multi-domain auth flows (for example dashboard + access subdomains).

## 4) Output rules

- Always parse JSON from stdout.
- Avoid `--pretty` in automated loops.
- Treat non-zero process exit as failure and decode `code` from JSON.
- Prefer `targetId` from `open` when taking snapshots; use `target list --session <id>` only when recovering from lost handles.
- Contract ids are executable aliases: `target.find`, `target.click`, `session.ensure`, `state.reconcile`, etc.

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

For explicit teardown where you want all session state cleared and associated browsers closed:

```bash
surfwright --json session clear
```

- default behavior attempts browser shutdown for every tracked session before clearing state
- use `--keep-processes` only when intentionally preserving running browsers
