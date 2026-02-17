---
name: surfwright
description: Use when controlling a browser through the SurfWright CLI in deterministic agent loops. Prefer default JSON output, explicit `sessionId`/`targetId` handles, and typed error-code handling.
---

# SurfWright Skill

## When to use

- You need deterministic browser control through the `surfwright` CLI.
- You need typed failure handling (`code` + `message`) instead of brittle text parsing.
- You need session-aware loops with explicit handles.

## Agent operating contract

1. Assume JSON output by default. Use `--no-json` only when a human needs summaries.
2. Bootstrap capabilities once per run with:

```bash
surfwright contract
```

3. Prefer isolated defaults: start with `open` (no `--session`) and chain with returned `targetId`.
4. Use `--isolation shared` only when you intentionally want shared managed-session reuse.
5. Treat every non-zero exit as a typed failure and branch on `code`.
6. Keep loops small: open once, act once, verify, repeat.
7. For project-persistent auth across agents, initialize a workspace and use `--profile <name>`:

```bash
surfwright workspace init
surfwright open https://app.example.com/login --profile auth --browser-mode headed
```

This stores the browser profile under `./.surfwright/` (gitignored), so future agents can reuse the same logged-in state with `--profile auth`.
8. For authenticated carry-over between disposable sessions, use `session cookie-copy` between explicit source/destination sessions with one or more scoped `--url` values.

## Canonical loop

```bash
surfwright open https://example.com
surfwright target frames <targetId>
surfwright target snapshot <targetId>
surfwright target find <targetId> --selector a --contains "query" --first --visible-only
surfwright target click <targetId> --text "query" --visible-only
surfwright target read <targetId> --selector main --frame-scope main --chunk-size 1200 --chunk 1
surfwright target extract <targetId> --kind blog --frame-scope all --limit 10
surfwright target eval <targetId> --expr "console.log('hello from agent'), document.title" --capture-console
surfwright target wait <targetId> --for-selector "h1"
surfwright target console-tail <targetId> --capture-ms 2000 --levels error,warn
surfwright target health <targetId>
surfwright target hud <targetId>
surfwright target network <targetId> --profile perf --view summary
surfwright target network-tail <targetId> --profile api --capture-ms 3000 --max-events 200
surfwright target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright target network-begin <targetId> --action-id checkout-click --profile api --max-runtime-ms 600000
surfwright target network-end <captureId> --view summary --status 5xx
surfwright target network-export <targetId> --profile page --reload --capture-ms 3000 --out ./artifacts/capture.har
surfwright target network-export-list --limit 20
surfwright target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright target network-check <targetId> --budget ./budgets/network.json --profile perf --capture-ms 5000 --fail-on-violation
surfwright session cookie-copy --from-session a-login --to-session s-checkout --url https://github.com
```

`open` returns `sessionId`, `sessionSource`, and `targetId`; persist these handles in your run state. `target *` commands can infer the session from `targetId` when `--session` is omitted.

## Snapshot Orientation (Quiet First Pass)

Use `target snapshot --mode orient` when you want a compact first-load orientation payload without noisy inventories:

```bash
surfwright target snapshot <targetId> --mode orient --visible-only
```

In `orient` mode, `links` are scoped to header/nav links (bounded) and the report includes `h1` when available.

## Snapshot Paging + Selector Hints

If a snapshot inventory is too large, page it deterministically via `nextCursor`:

```bash
PAGE1=$(surfwright target snapshot <targetId> --max-links 20 --max-buttons 0)
CURSOR=$(printf '%s' "$PAGE1" | jq -r '.nextCursor // empty')
PAGE2=$(surfwright target snapshot <targetId> --cursor "$CURSOR" --max-links 20 --max-buttons 0)
```

Use `--include-selector-hints` when you want bounded `items.*.selectorHint` rows for direct follow-up actions:

```bash
surfwright target snapshot <targetId> --include-selector-hints --max-buttons 12 --max-links 12
```

## Frames + iframe eval

Use `target frames` to enumerate stable `frameId` handles. Use `--frame-id` on `target eval` to run JS inside a specific iframe. Prefer `--expr` when you want expression values without remembering `return`.

```bash
surfwright target frames <targetId> --limit 50
surfwright target eval <targetId> --frame-id f-1 --expr "document.title"
```

## Multi-Match Click (Nth Match)

Use `--index <n>` (0-based) when your query matches multiple elements and you need a deterministic choice without selector hacks:

```bash
surfwright target click <targetId> --text "Delete" --visible-only --index 1
```

If a click fails due to visibility/filtering, rerun with `--explain` to get bounded rejection reasons (no click performed):

```bash
surfwright target click <targetId> --text "Delete" --visible-only --explain
```

## Evidence-Based Click Delta (What Changed?)

Use `target click --delta` when you need a bounded "what changed after the click?" payload without extra probing commands:

```bash
surfwright target click <targetId> --text "Launch demo modal" --visible-only --wait-for-selector "[aria-modal=\"true\"]" --delta
```

The `delta` payload is evidence-only (no semantic UI narratives) and includes:

- URL/title before/after
- focus before/after (`selectorHint` + small text preview)
- role counts before/after for `dialog|alert|status|menu|listbox`
- a fixed list of ARIA attribute values captured on the clicked element

## URL drift guard (Optional)

After a navigation, assert you're still on the expected host/origin/path before taking stateful actions:

```bash
surfwright target url-assert <targetId> --host github.com --path-prefix /login
```

## Human Login Handoff (Headed)

Default managed sessions are `headless`. When you need a visible browser for a human to complete auth/2FA, launch a headed managed session and keep using its explicit `sessionId`:

```bash
surfwright workspace init
surfwright open https://github.com/login --profile auth --browser-mode headed

# Human: finish login in the headed browser window, then continue.
surfwright target snapshot <targetId>
```

`--profile auth` is the smoothest path for future agents: the login state is persisted under `./.surfwright/` and reused automatically on the next run.

If you need an ad-hoc headed session without persisting auth, use `session new --browser-mode headed` and pass `--session <id>`.

If local state may be stale (machine restart, browser crash), run:

```bash
surfwright state reconcile
```

For full teardown between runs (state + processes), run:

```bash
surfwright session clear
```

## Error discipline

Use `references/error-handling.md` as the canonical retry taxonomy (branch on `code`, not `message`).

## Streaming commands (NDJSON)

`target console-tail` and `target network-tail` stream one JSON object per line (NDJSON) to stdout.

- Streaming tails default to NDJSON-only. If you run with `--no-json`, stdout will be NDJSON lines plus a final `ok ...` summary line.
- Stop reading when you see the final capture event: `{"type":"capture","phase":"end",...}`.
- Use `--max-events <n>` on `target network-tail` to cap event volume (the final `capture end` line is still emitted).

## Reference map

- Workflow patterns: `references/workflows.md`
- Failure handling matrix: `references/error-handling.md`
