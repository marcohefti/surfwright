---
name: surfwright
description: Use when controlling a browser through the SurfWright CLI in deterministic agent loops. Prefer default JSON output, explicit `sessionId`/`targetId` handles, and typed error-code handling.
---

# SurfWright Skill

## When To Use

- You need deterministic browser control through the `surfwright` CLI.
- You need explicit handles (`sessionId`, `targetId`) instead of implicit active-tab state.
- You need typed errors (`code`, `message`, `retryable`) for stable automation branches.

## Runtime Source Of Truth

Always refresh command/error truth from runtime before non-trivial loops:

```bash
surfwright --json contract
```

Do not assume docs are fresher than the contract payload.

## Operating Protocol

1. Keep JSON output on (default). Use `--no-json` only for human-facing summaries.
2. Start with explicit handles: `open` -> persist returned `sessionId` + `targetId`.
3. Run short loops: orient -> act -> verify -> repeat.
4. Prefer isolated sessions by default. Use `--isolation shared` only when continuity is intentional.
5. Use workspace profiles for durable auth: `workspace init`, then `open --profile <name>`.
6. Use `session cookie-copy` for cross-session auth handoff.
7. Treat every non-zero exit as typed failure and branch on `code`, never message text.
8. Keep capture volumes bounded (`--max-*`, `--limit`, `--capture-ms`) for token and runtime control.
9. Use `state reconcile` after restart/crash before deeper debugging.

## Minimal Agent Loop

```bash
OPEN=$(surfwright open https://example.com)
TARGET=$(printf '%s' "$OPEN" | jq -r '.targetId')

surfwright target snapshot "$TARGET" --mode orient --visible-only
surfwright target find "$TARGET" --text "Pricing" --first --visible-only --href-host example.com --href-path-prefix /pricing
surfwright target click "$TARGET" --text "Pricing" --visible-only --delta
surfwright target read "$TARGET" --selector main --chunk-size 1200 --chunk 1
```

## Handle Discipline

- `open` returns `sessionId`, `sessionSource`, and `targetId`; store all of them.
- `target *` can infer session from `targetId`; pass `--session` only when recovery needs it.
- If handles are lost, recover with `target list --session <id>` and continue from returned `targetId`.

## Reference Map

- Goal-based command recipes: `references/workflows.md`
- Symptom-based debugging runbook: `references/troubleshooting.md`
- Error codes and retry discipline: `references/error-handling.md`
