---
name: surfwright
description: Use SurfWright CLI for deterministic browser loops. Prefer JSON output, explicit `sessionId`/`targetId` handles, and typed error codes.
---

# SurfWright Skill

Deterministic browser control via CLI JSON outputs and explicit handles.

## Discovery

- Do not probe with `which`, help flags, or repeated skill file reads.
- Use direct commands first.
- Use `surfwright contract --commands <id1,id2,...>` only when a command is unknown.
- Use `surfwright contract --command <id>` for one command schema.

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Confirm required JSON schema with `surfwright contract --command <id>` only after a command-id miss.
- Start headless by default unless explicitly instructed otherwise.
- Treat non-zero exits as typed failures and branch on `code` (`retryable` when present).
- Use one unique `--agent-id` per task.
- Treat daemon queue overload codes (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) as backpressure signals.
- Treat daemon transport unreachability as fallback-eligible; if continuity is required during daemon diagnostics, use `SURFWRIGHT_DAEMON=0` as hard-off.
- Help output is intentionally disabled; use `contract` lookup only.
- For non-trivial plans, prefer `run --plan <file>` (or `--plan -`) over inline `--plan-json`.
- For complex JavaScript, prefer `target eval --script-file` / `--script-b64` over long quoted inline expressions.
- Prefer typed primitives over eval:
  - `target count` for cardinality checks.
  - `target attr --name <attribute>` for deterministic attribute reads (for example `href`, `src`).
  - `target click --nth <n>` for deterministic disambiguation.
  - `target click --count-after` (or `--expect-count-after`) for post-action selector checks.
