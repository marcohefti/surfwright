# SurfWright Scoped Benchmark Loop

This is the repository-native loop for iterative SurfWright optimization.

## Intent

- Use ZCL campaigns directly.
- Run one mission scope per campaign iteration (single mission or cluster).
- Allow configurable parallel fan-out per mission (`agentsPerMission`) for variance/robustness sampling.
- Apply one concrete code change between iterations.
- Track improvement/regression in per-scope result sheets under `tmp/`.

## Iteration Semantics (Mandatory)

- `iteration` defaults to optimization (`--mode optimize`).
- Optimize iteration = `change -> run -> evaluate -> next change`.
- `sample` is no-change variance measurement and must be explicit (`--mode sample`).
- If an operator asks for "N iterations", execute `N` optimize iterations unless they explicitly ask for samples.

## Versioned Loop Assets

- Config: `bench/agent-loop/config.json`
- Protocol: `bench/agent-loop/AGENT_LOOP.md`

## Non-Versioned Loop Outputs

- Scope outputs: `tmp/zerocontext/bench-loop/scopes/<scopeId>/`
  - `history.jsonl`
  - `RESULT_SHEET.md`
  - `RESULT_SHEET.json`
  - `NEXT_ITERATION_TASK.md`

### Config Knobs

`bench/agent-loop/config.json`:

- `agentsPerMission`: default parallel fan-out per mission.
- `nativeMaxInflightPerStrategy`: native runner concurrency cap (must be `>= agentsPerMission`).
- `nativeMinStartIntervalMs`: launch staggering for native runs.

## Non-Versioned Run Artifacts

- `tmp/zerocontext/bench-loop/<loopId>/<scopeId>/<iterationId>/...`

Each iteration folder contains spec, lint/doctor/run/report logs, run-state, mission metrics, and trace-derived command stats.

## Runtime Pinning

- model: `gpt-5.3-codex-spark`
- reasoning effort: `medium`
- reasoning policy: `best_effort`
- `freshAgentPerAttempt: true` (one fresh agent per `flow+mission` attempt)
- `agentsPerMission`: fan-out count per mission run (config default, override with `--agents-per-mission`)

## Commands

Default scope from config:

```bash
pnpm bench:loop:run --mode sample --label baseline --hypothesis "baseline sample" --change "no code change" --tags sample
```

Single mission scope:

```bash
pnpm bench:loop:run --mode sample --label baseline --mission-id 014-infinite-scroll-chunks --hypothesis "baseline sample" --change "no code change" --tags sample
```

Single mission with parallel fan-out (3 agents in one run):

```bash
pnpm bench:loop:run --mode sample --label baseline-a3 --mission-id 014-infinite-scroll-chunks --agents-per-mission 3 --hypothesis "variance sample with parallel fan-out" --change "no code change" --tags sample
```

Scoring is flow-family based: `score-iteration` aggregates all `surfwright*` flow shards via `--flow-prefix surfwright`.

Cluster scope:

```bash
pnpm bench:loop:run \
  --mode sample \
  --label baseline-5 \
  --mission-ids 003-multimatch-disambiguation,010-new-window-spawn,013-dynamic-loading,014-infinite-scroll-chunks,016-docs-commands-extract \
  --hypothesis "baseline sample" \
  --change "no code change" \
  --tags sample
```

Run one changed iteration:

```bash
pnpm bench:loop:run \
  --mode optimize \
  --label exp-1 \
  --mission-id 014-infinite-scroll-chunks \
  --hypothesis "<why this should help>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
```

Run explicit no-change sample:

```bash
pnpm bench:loop:run \
  --mode sample \
  --label sample-1 \
  --mission-id 014-infinite-scroll-chunks \
  --hypothesis "variance sample" \
  --change "no code change" \
  --tags sample
```

Refresh result sheet for a scope:

```bash
pnpm bench:loop:history --mission-id 014-infinite-scroll-chunks
```

## Headless Guard

Loop runs include a `surfwright` wrapper in campaign env that hard-fails any `--browser-mode headed` command before launch.
Headless guard scoring counts successful headed executions; blocked headed commands fail fast and do not count as headed launches.

## Session Policy

- Run optimize loop development on a feature branch (not `main`).
- Keep one commit per optimize iteration change to preserve a clean historical chain.
- Do not push unless explicitly requested.
- High-risk refactors are allowed when backed by iteration evidence.
- Keep prompts mission-only/exam-style (no oracle leakage).
- Scope histories are append-only (no reset command).
