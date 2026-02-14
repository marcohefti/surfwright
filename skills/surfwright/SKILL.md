---
name: surfwright
description: Use when controlling a browser through the SurfWright CLI in deterministic agent loops. Prefer `--json` output, explicit `sessionId`/`targetId` handles, and typed error-code handling.
---

# SurfWright Skill

## When to use

- You need deterministic browser control through the `surfwright` CLI.
- You need typed failure handling (`code` + `message`) instead of brittle text parsing.
- You need session-aware loops with explicit handles.

## Agent operating contract

1. Always use `--json` for machine loops.
2. Bootstrap capabilities once per run with:

```bash
surfwright --json contract
```

3. Prefer isolated defaults: start with `open` (no `--session`) and chain with returned `targetId`.
4. Use `--isolation shared` only when you intentionally want shared managed-session reuse.
5. Treat every non-zero exit as a typed failure and branch on `code`.
6. Keep loops small: open once, act once, verify, repeat.
7. For authenticated carry-over, use `session cookie-copy` between explicit source/destination sessions with one or more scoped `--url` values.

## Canonical loop

```bash
surfwright --json open https://example.com
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "query" --first --visible-only
surfwright --json target click <targetId> --text "query" --visible-only
surfwright --json target read <targetId> --selector main --frame-scope main --chunk-size 1200 --chunk 1
surfwright --json target extract <targetId> --kind blog --frame-scope all --limit 10
surfwright --json target eval <targetId> --js "console.log('hello from agent'); return document.title" --capture-console
surfwright --json target wait <targetId> --for-selector "h1"
surfwright target console-tail <targetId> --capture-ms 2000 --levels error,warn
surfwright --json target health <targetId>
surfwright --json target hud <targetId>
surfwright --json target network <targetId> --profile perf --view summary
surfwright target network-tail <targetId> --profile api --capture-ms 3000
surfwright --json target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright --json target network-begin <targetId> --action-id checkout-click --profile api --max-runtime-ms 600000
surfwright --json target network-end <captureId> --view summary --status 5xx
surfwright --json target network-export <targetId> --profile page --reload --capture-ms 3000 --out ./artifacts/capture.har
surfwright --json target network-export-list --limit 20
surfwright --json target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright --json target network-check <targetId> --budget ./budgets/network.json --profile perf --capture-ms 5000 --fail-on-violation
surfwright --json session cookie-copy --from-session a-login --to-session s-checkout --url https://dashboard.stripe.com --url https://access.stripe.com
```

`open` returns `sessionId`, `sessionSource`, and `targetId`; persist these handles in your run state. `target *` commands can infer the session from `targetId` when `--session` is omitted.

If local state may be stale (machine restart, browser crash), run:

```bash
surfwright --json state reconcile
```

For full teardown between runs (state + processes), run:

```bash
surfwright --json session clear
```

## Error discipline

- Retry only retryable infrastructure failures (`E_CDP_UNREACHABLE`, `E_BROWSER_START_TIMEOUT`, `E_STATE_LOCK_TIMEOUT`, `E_INTERNAL`, `E_WAIT_TIMEOUT`).
- Do not retry input/config failures (`E_URL_INVALID`, `E_CDP_INVALID`, `E_SESSION_ID_INVALID`, `E_SESSION_EXISTS`, `E_SESSION_REQUIRED`).
- Do not retry target/query failures (`E_TARGET_ID_INVALID`, `E_TARGET_NOT_FOUND`, `E_TARGET_SESSION_UNKNOWN`, `E_TARGET_SESSION_MISMATCH`, `E_QUERY_INVALID`, `E_ASSERT_FAILED`, `E_SELECTOR_INVALID`, `E_EVAL_SCRIPT_TOO_LARGE`, `E_EVAL_RUNTIME`, `E_EVAL_RESULT_UNSERIALIZABLE`) until command inputs change.
- Treat `E_EVAL_TIMEOUT` as retryable infrastructure timeout only when eval payload is unchanged and idempotent.
- If `E_SESSION_UNREACHABLE` occurs on an attached session, re-attach explicitly.

## Reference map

- Workflow patterns: `references/workflows.md`
- Failure handling matrix: `references/error-handling.md`
