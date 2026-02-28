# SurfWright Benchmark Loop (Scoped Histories)

This loop is repository-native: protocol, config, scripts, and per-scope result sheets live in `bench/agent-loop`.

## Goal

Run an agent-improvement loop where each cycle is:

1. one new ZCL campaign,
2. one mission scope (single mission or cluster),
3. one fresh agent per `flow+mission` attempt,
4. one concrete code change between runs.

## Iteration Semantics (Strict)

- `iteration` means an `optimize` iteration by default.
- `optimize` iteration contract:
  - one concrete change is required,
  - one run is executed,
  - artifacts are evaluated before the next change.
- `sample` run means no-change variance/baseline measurement.
- If a user says "run N iterations", interpret it as `N` optimize iterations unless they explicitly request sampling.

## Hard Rules

- Use a dedicated feature branch for loop work; do not run optimize loop development directly on `main`.
- Keep one commit per optimize iteration change so later sessions can trace what changed and why.
- Push is optional and operator-controlled; do not push unless explicitly requested.
- Runs/artifacts stay out of git under `tmp/`.
- Use mission-only exam prompts (no oracle leakage).
- `agentsPerMission` controls parallel fresh-agent fan-out per mission in one run.
- Keep model pinned:
  - `gpt-5.3-codex-spark`
  - reasoning effort `medium`
  - reasoning policy `best_effort`

## Config Knobs

In `bench/agent-loop/config.json`:

- `agentsPerMission`: default parallel flow fan-out per mission (`1` = one agent).
- `nativeMaxInflightPerStrategy`: native runner concurrency cap (must be `>= agentsPerMission`).
- `nativeMinStartIntervalMs`: native runner start staggering.

## Scope Model

Each mission scope gets its own append-only history:

- scope id = derived from mission set (or explicit `--scope-id`)
- scope directory = `tmp/zerocontext/bench-loop/scopes/<scopeId>/`
- scope ledger = `tmp/zerocontext/bench-loop/scopes/<scopeId>/history.jsonl`
- scope result sheet = `tmp/zerocontext/bench-loop/scopes/<scopeId>/RESULT_SHEET.md`

Examples:

- single mission scope: `--mission-id 009-infinite-scroll-chunks`
- cluster scope: `--mission-ids 001-first-pass-orientation,002-style-inspection,006-new-window-spawn,008-dynamic-loading,010-download-file`
- agent fan-out (per run): `--agents-per-mission 3` or `bench/agent-loop/config.json -> agentsPerMission`

## Commands

Default mission baseline (from config):

```bash
pnpm bench:loop:run --mode sample --label baseline --hypothesis "baseline sample" --change "no code change" --tags sample
```

Explicit single mission scope:

```bash
pnpm bench:loop:run --mode sample --label baseline --mission-id 009-infinite-scroll-chunks --hypothesis "baseline sample" --change "no code change" --tags sample
```

Single mission with 3 parallel agents in one run:

```bash
pnpm bench:loop:run --mode sample --label baseline-a3 --mission-id 009-infinite-scroll-chunks --agents-per-mission 3 --hypothesis "variance with 3 agents" --change "no code change" --tags sample
```

Scoring note: `run-iteration` calls `score-iteration` with `--flow-prefix surfwright`, so all `surfwright*` fan-out flows are aggregated into one iteration metric set.

Explicit 5-mission cluster scope:

```bash
pnpm bench:loop:run \
  --mode sample \
  --label baseline-5 \
  --mission-ids 001-first-pass-orientation,002-style-inspection,006-new-window-spawn,008-dynamic-loading,010-download-file \
  --hypothesis "baseline sample" \
  --change "no code change" \
  --tags sample
```

Run next iteration after a real code change:

```bash
pnpm bench:loop:run \
  --mode optimize \
  --label exp-1 \
  --mission-id 009-infinite-scroll-chunks \
  --hypothesis "<why this change should help>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
```

Run an explicit no-change sample (only when requested):

```bash
pnpm bench:loop:run \
  --mode sample \
  --label sample-1 \
  --mission-id 009-infinite-scroll-chunks \
  --hypothesis "variance sample" \
  --change "no code change" \
  --tags sample
```

Rebuild result sheet for a scope:

```bash
pnpm bench:loop:history --mission-id 009-infinite-scroll-chunks
pnpm bench:loop:history --scope-id mission-009-infinite-scroll-chunks
```

Branch + commit trace setup:

```bash
git checkout -b feature/bench-loop-<scope-or-theme>
```

After each optimize iteration is evaluated:

```bash
git add <changed-files>
git commit -m "feat(bench): <scope> iNNN <change-summary>"
```

## Versioned Assets (in repo)

- Loop config: `bench/agent-loop/config.json`
- Loop protocol: `bench/agent-loop/AGENT_LOOP.md`

## Non-Versioned Outputs

- Scope ledgers/results: `tmp/zerocontext/bench-loop/scopes/<scopeId>/...`
- Run artifacts: `tmp/zerocontext/bench-loop/<loopId>/<scopeId>/<iterationId>/...`

History is append-only. There is no reset flag.

These include spec, lint/doctor/run/report logs, run-state, trace metrics, and attempt artifacts.
