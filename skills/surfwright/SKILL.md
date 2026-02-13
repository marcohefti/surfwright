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

3. Use explicit sessions; do not rely on hidden tab state.
4. Treat every non-zero exit as a typed failure and branch on `code`.
5. Keep loops small: ensure session, act once, verify, repeat.

## Canonical loop

```bash
surfwright --json session ensure
surfwright --json open https://example.com --reuse-url
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "query" --first --visible-only
surfwright --json target read <targetId> --selector main --chunk-size 1200 --chunk 1
surfwright --json target wait <targetId> --for-selector "h1"
surfwright --json target network <targetId> --capture-ms 2500 --status 2xx
surfwright --json target network-export <targetId> --reload --capture-ms 3000 --out ./artifacts/capture.har
```

`open` returns `sessionId` and `targetId`; persist these handles in your run state and use `target snapshot` / `target find` / `target read` / `target wait` / `target network` for bounded page reads, deterministic readiness checks, and compact network diagnostics.

If local state may be stale (machine restart, browser crash), run:

```bash
surfwright --json state reconcile
```

## Error discipline

- Retry only retryable infrastructure failures (`E_CDP_UNREACHABLE`, `E_BROWSER_START_TIMEOUT`, `E_STATE_LOCK_TIMEOUT`, `E_INTERNAL`).
- Do not retry input/config failures (`E_URL_INVALID`, `E_CDP_INVALID`, `E_SESSION_ID_INVALID`, `E_SESSION_EXISTS`).
- Do not retry target/query failures (`E_TARGET_ID_INVALID`, `E_TARGET_NOT_FOUND`, `E_QUERY_INVALID`, `E_SELECTOR_INVALID`) until command inputs change.
- If `E_SESSION_UNREACHABLE` occurs on an attached session, re-attach explicitly.

## Reference map

- Workflow patterns: `references/workflows.md`
- Failure handling matrix: `references/error-handling.md`
