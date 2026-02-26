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
Use `surfwright contract --command <id>` for low-token per-command flags/positionals/examples.
Use `surfwright contract --full --search <term>` only for explicit debug/audit.

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Use `surfwright contract --command <id>` to confirm the required JSON schema before parsing outputs.
- Start SurfWright in headless mode by default unless explicitly instructed otherwise.
- Treat non-zero exits as typed failures and branch on `code` (and `retryable` when present).
- Use one unique `--agent-id` per task.
- Treat daemon queue overload codes (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) as explicit backpressure signals (do not assume local fallback).
- Treat daemon transport unreachability as fallback-eligible; if continuity is required during daemon diagnostics, use `SURFWRIGHT_DAEMON=0` as hard-off.
- Prefer typed primitives over eval:
  - `target count` for cardinality checks.
  - `target attr --name <attribute>` for deterministic DOM attribute reads (for example `href`, `src`).
  - `target click --nth <n>` for deterministic disambiguation.
  - `target click --count-after` (or `--expect-count-after`) for post-action selector checks.
