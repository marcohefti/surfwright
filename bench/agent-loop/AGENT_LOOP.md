# SurfWright Benchmark Loop (Scoped Histories)

This loop is repository-native: protocol, config, scripts, and per-scope result sheets live in `bench/agent-loop`.

## Goal

Run an agent-improvement loop where each cycle is:

1. one new ZCL campaign,
2. one mission scope (single mission or cluster),
3. fresh agent per mission attempt,
4. one concrete code change between runs.

## Hard Rules

- No commit/push unless explicitly requested.
- Runs/artifacts stay out of git under `tmp/`.
- Use mission-only exam prompts (no oracle leakage).
- Keep model pinned:
  - `gpt-5.3-codex-spark`
  - reasoning effort `medium`
  - reasoning policy `best_effort`

## Scope Model

Each mission scope gets its own versioned history:

- scope id = derived from mission set (or explicit `--scope-id`)
- scope directory = `bench/agent-loop/scopes/<scopeId>/`
- scope ledger = `bench/agent-loop/scopes/<scopeId>/history.jsonl`
- scope result sheet = `bench/agent-loop/scopes/<scopeId>/RESULT_SHEET.md`

Examples:

- single mission scope: `--mission-id 018-infinite-scroll-chunks`
- cluster scope: `--mission-ids 001-docs-install-command,006-multimatch-disambiguation,013-new-window-spawn,017-dynamic-loading,018-infinite-scroll-chunks`

## Commands

Default mission baseline (from config):

```bash
pnpm bench:loop:run --label baseline
```

Explicit single mission scope:

```bash
pnpm bench:loop:run --label baseline --mission-id 018-infinite-scroll-chunks
```

Explicit 5-mission cluster scope:

```bash
pnpm bench:loop:run \
  --label baseline-5 \
  --mission-ids 001-docs-install-command,006-multimatch-disambiguation,013-new-window-spawn,017-dynamic-loading,018-infinite-scroll-chunks
```

Run next iteration after a real code change:

```bash
pnpm bench:loop:run \
  --label exp-1 \
  --mission-id 018-infinite-scroll-chunks \
  --hypothesis "<why this change should help>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
```

Rebuild result sheet for a scope:

```bash
pnpm bench:loop:history --mission-id 018-infinite-scroll-chunks
pnpm bench:loop:history --scope-id mission-018-infinite-scroll-chunks
```

## Versioned Outputs (in repo)

- Loop config: `bench/agent-loop/config.json`
- Scope ledgers/results: `bench/agent-loop/scopes/<scopeId>/...`

History is append-only. There is no reset flag.

## Non-Versioned Outputs (run artifacts)

- `tmp/zerocontext/bench-loop/<loopId>/<scopeId>/<iterationId>/...`

These include spec, lint/doctor/run/report logs, run-state, trace metrics, and attempt artifacts.
