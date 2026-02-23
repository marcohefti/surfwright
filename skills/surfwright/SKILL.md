---
name: surfwright
description: Use when controlling a browser through the SurfWright CLI in deterministic agent loops. Prefer default JSON output, explicit `sessionId`/`targetId` handles, and typed error-code handling.
---

# SurfWright Skill

Deterministic browser control via CLI JSON outputs and explicit handles.

## Discovery

Use contract lookup first:

`surfwright contract --core --search <term>`

Use `surfwright contract --search <term>` when you need a broader list.
Use `surfwright contract --full --search <term>` only for explicit debug/audit.

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Treat non-zero exits as typed failures and branch on `code` (and `retryable` when present).
- Use one unique `--agent-id` per task.
- Standard lifecycle: `session fresh` -> `open` -> act/verify -> `session clear`.
- Prefer typed primitives over eval:
  - `target count` for cardinality checks.
  - `target click --nth <n>` for deterministic disambiguation.
  - `target click --count-after` (or `--expect-count-after`) for post-action selector checks.
- Prefer multi-step bundling with `run --plan-json` when a task requires multiple deterministic actions.
- Return final answers only in the required JSON schema.
