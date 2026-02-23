# SurfWright Scoped Benchmark Loop

This is the repository-native loop for iterative SurfWright optimization.

## Intent

- Use ZCL campaigns directly.
- Run one mission scope per campaign iteration (single mission or cluster).
- Apply one concrete code change between iterations.
- Track improvement/regression in a versioned per-scope result sheet.

## Versioned Loop Assets

- Config: `bench/agent-loop/config.json`
- Protocol: `bench/agent-loop/AGENT_LOOP.md`
- Scope outputs: `bench/agent-loop/scopes/<scopeId>/`
  - `history.jsonl`
  - `RESULT_SHEET.md`
  - `RESULT_SHEET.json`
  - `NEXT_ITERATION_TASK.md`

## Non-Versioned Run Artifacts

- `tmp/zerocontext/bench-loop/<loopId>/<scopeId>/<iterationId>/...`

Each iteration folder contains spec, lint/doctor/run/report logs, run-state, mission metrics, and trace-derived command stats.

## Runtime Pinning

- model: `gpt-5.3-codex-spark`
- reasoning effort: `medium`
- reasoning policy: `best_effort`
- `freshAgentPerAttempt: true`

## Commands

Default scope from config:

```bash
pnpm bench:loop:run --label baseline
```

Single mission scope:

```bash
pnpm bench:loop:run --label baseline --mission-id 018-infinite-scroll-chunks
```

Cluster scope:

```bash
pnpm bench:loop:run \
  --label baseline-5 \
  --mission-ids 001-docs-install-command,006-multimatch-disambiguation,013-new-window-spawn,017-dynamic-loading,018-infinite-scroll-chunks
```

Run one changed iteration:

```bash
pnpm bench:loop:run \
  --label exp-1 \
  --mission-id 018-infinite-scroll-chunks \
  --hypothesis "<why this should help>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
```

Refresh result sheet for a scope:

```bash
pnpm bench:loop:history --mission-id 018-infinite-scroll-chunks
```

## Headless Guard

Loop runs include a `surfwright` wrapper in campaign env that rewrites `--browser-mode headed` to `headless`.
If any headed call still appears in traces, the iteration fails with a headless-guard error.

## Session Policy

- No commit/push during loop runs unless explicitly requested.
- High-risk refactors are allowed when backed by iteration evidence.
- Keep prompts mission-only/exam-style (no oracle leakage).
- Scope histories are append-only (no reset command).
