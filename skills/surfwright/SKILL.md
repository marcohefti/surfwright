---
name: surfwright
description: Use SurfWright CLI for deterministic browser loops. Prefer JSON output, explicit `sessionId`/`targetId` handles, and typed error codes.
---

# SurfWright Skill

Deterministic browser control via CLI JSON outputs and explicit handles.

## Discovery

Use contract lookup first.

- `surfwright contract --search <term>` for focused discovery.
- `surfwright contract --command <id>` for one command schema.
- Use `--full` only for explicit debug/audit.

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Use `surfwright contract --command <id>` to confirm the required JSON schema before parsing.
- Start headless by default unless explicitly instructed otherwise.
- Treat non-zero exits as typed failures and branch on `code` (`retryable` when present).
- Use one unique `--agent-id` per task.
- Treat daemon queue overload codes (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) as explicit backpressure signals (do not assume local fallback).
- Treat daemon transport unreachability as fallback-eligible; if continuity is required during daemon diagnostics, use `SURFWRIGHT_DAEMON=0` as hard-off.
- Prefer contract-first discovery over broad help probing.
- For non-trivial plans, prefer `run --plan <file>` (or `--plan -`) over inline `--plan-json`.
- For complex JavaScript, prefer `target eval --script-file` / `--script-b64` over long quoted inline expressions.
- Prefer typed primitives over eval:
  - `target count` for cardinality checks.
  - `target attr --name <attribute>` for deterministic attribute reads (for example `href`, `src`).
  - `target click --nth <n>` for deterministic disambiguation.
  - `target click --count-after` (or `--expect-count-after`) for post-action selector checks.
