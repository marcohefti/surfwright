---
name: surfwright
description: Use when controlling a browser through the SurfWright CLI in deterministic agent loops. Prefer default JSON output, explicit `sessionId`/`targetId` handles, and typed error-code handling.
---

# SurfWright Skill

Deterministic browser control via CLI JSON outputs with explicit handles.

## Discovery

Use contract lookup first, not broad help scans:

`surfwright contract --search <term>`

Use `surfwright contract --full --search <term>` only for explicit debugging.

## Minimal Agent Loop

```bash
AID="task-$(date +%s)"
SESSION=$(surfwright --agent-id "$AID" session fresh --browser-mode headless | jq -r '.sessionId')
OPEN=$(surfwright --agent-id "$AID" open https://example.com --session "$SESSION" --reuse off --browser-mode headless)
TARGET=$(printf '%s' "$OPEN" | jq -r '.targetId')

surfwright --agent-id "$AID" target snapshot "$TARGET" --mode orient --visible-only
surfwright --agent-id "$AID" target find "$TARGET" --text "Pricing" --visible-only --limit 20
surfwright --agent-id "$AID" target click "$TARGET" --text "Pricing" --visible-only --index 0 --proof
surfwright --agent-id "$AID" target url-assert "$TARGET" --path-prefix /pricing
surfwright --agent-id "$AID" session clear
```

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Treat non-zero exits as typed failures and branch on `code`.
- Use one unique `--agent-id` per task; clear owned state with `session clear`.
- Return final answers only in the user-required JSON schema.

## Reference Map

- Optional recipes: `references/workflows.md`
- Typed failure handling: `references/error-handling.md`
- Debug runbook: `references/troubleshooting.md`
