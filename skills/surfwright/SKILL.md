---
name: surfwright
description: Use SurfWright CLI for deterministic browser control. Prefer JSON, explicit handles, and typed error codes.
---

# SurfWright Skill

Deterministic browser control with JSON-first CLI outputs and explicit handles.

## Discovery

- Use direct action commands first.
- Do not probe with `which`, help flags, or repeated skill file reads.
- Do not run plain `surfwright contract` in normal loops.
- Use `surfwright contract --command <id>` only after a command-id miss.
- Use `surfwright contract --commands <id1,id2,...>` for small batches of misses.
- Use `surfwright contract --full` only when you need the full id catalogs.

## Runtime Rules

- Keep default JSON output; do not parse prose.
- Confirm required JSON schema via `surfwright contract --command <id>` only after a command-id miss.
- Start headless by default unless explicitly instructed otherwise.
- Treat non-zero exits as typed failures and branch on `code` (`retryable` when present).
- Use one unique `--agent-id` per task.
- Treat daemon queue overload codes (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) as backpressure.
- If daemon transport is unreachable and continuity matters, use `SURFWRIGHT_DAEMON=0`.
- Help output is intentionally disabled; use contract lookup only.
- For non-trivial plans, prefer `run --plan <file>` (or `--plan -`) over inline `--plan-json`.
- For complex JavaScript, prefer `target eval --script-file` / `--script-b64`.
- Prefer typed primitives over eval:
  - `target count` for cardinality checks.
  - `target attr --name <attribute>` for deterministic attribute reads.
  - `target click --nth <n>` for deterministic disambiguation.
  - `target click --count-after` (or `--expect-count-after`) for post-action selector checks.
