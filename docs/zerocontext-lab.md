# ZeroContext Lab

ZeroContext Lab (ZCL) is the workflow we use to evaluate cold-start agent UX for SurfWright.
ZCL itself is intentionally **external** to SurfWright runtime behavior; this repo does not ship a ZCL implementation.

## Purpose

Use this when you want to measure what a fresh agent does on first contact:

- first-try success rate,
- command count to completion,
- runtime per task,
- recurring friction from agent feedback,
- missing-command demand based on real command attempts,
- architecture fit (new primitive vs better naming/output for existing primitives).

## What It Captures

Per attempt, ZCL should write deterministic artifacts (exact filenames/layout are owned by ZCL; do not treat them as a SurfWright contract).
At minimum, we need:

- the exact prompt used,
- the exact runner/agent command used,
- attempt-level stdout/stderr logs or equivalent evidence for debugging,
- a tool-call trace (append-only JSONL) as primary evidence of what was attempted,
- structured feedback/outcome for the attempt,
- a normalized run summary and per-attempt outcomes/metrics.

The tool-call trace JSONL is the primary evidence of what the agent actually tried.
Agent self-reports are secondary.

## Trace Integrity Gate

Runs are valid only if browser actions are executed via the traced SurfWright CLI (`surfwright`).

- valid: `surfwright ...` (JSON output is default)
- invalid for discovery evidence: bypassing the traced SurfWright surface for browser actions (wrapper stacks that hide calls, direct Playwright scripts, etc.)

If browser actions bypass tracing, the tool-call trace may be incomplete and the run should be marked invalid for discovery scoring.

### SurfWright Command Name (Important)

In ZeroContext runs, we prefer the agent only ever types `surfwright` for browser actions.
If ZCL needs a wrapper/funnel mechanism, we route it behind that name (skill/docs-level wiring), so the agent still experiences “SurfWright speaks for itself”.

## Two Evaluation Modes

### Mode A: Harness-native one-turn suite

Use ZCL’s suite runner to execute one-turn missions with expectations and machine-readable results.
Best for repeatable CI-style measurements.

### Mode B: Capability-gap two-turn subagent workflow

Use this when discovering missing CLI primitives/names/output shapes:

1. Send a sparse mission prompt (minimal instruction, no implementation hints).
2. Let the agent attempt the mission without coaching.
3. Send a follow-up prompt asking how the CLI should improve.
4. Evaluate with both:
   - follow-up proposal (`decision tag`, `missing command`, `usage`, `output shape`),
   - trace evidence from the tool-call JSONL.

This mode is intentionally qualitative + evidence-backed. It is designed to reveal
natural command demand and where agents get stuck.

Keep campaign prompts/assets in a temporary workspace (for example `tmp/zero-context-gap/`) and exclude them from version control.

Follow-up prompting (default):

Ask for a natural-language proposal for how the CLI should improve.

Prefer that the agent includes:

- what they tried and where they got stuck
- one concrete improvement proposal (new command/flag, rename, output reshape, or “document existing”)
- an example usage line and an example one-line JSON output (when possible)

If the follow-up is vague or does not contain a concrete proposal, send a second follow-up prompt asking for a single concrete change (name + usage + one-line example output).

If you need a machine-parsed summary, use ZCL’s feedback mechanism (whatever ZCL currently documents as the canonical way to persist an attempt outcome).

Decision tags:

- `missing_primitive`: no first-class command/flag cleanly solves the mission.
- `naming_ux`: capability exists, but command naming/shape makes discovery hard.
- `output_shape`: capability exists, but returned payload is not actionable/compact enough.
- `already_possible_better_way`: agent got stuck, but a good existing workflow already solves it.

## Run

ZCL is external. Use whatever the current ZCL CLI documents.
If you need to confirm the published ZCL surface, prefer inspecting its contract output (for example, `zcl contract --json` if supported).

### Recommended Path (SurfWright)

For unbiased SurfWright discoverability, prefer a flow where the agent only ever types `surfwright` for browser actions, while ZCL still captures trace-backed evidence.
In practice, this is typically achieved via ZCL suite runs that can shim the `surfwright` command name for the runner environment (so `surfwright ...` is trace-backed without adding “ZCL ceremony” to the mission prompt).

For fast post-mortems, prefer a ZCL workflow that:
- captures runner IO per attempt (`runner.*` logs or equivalent),
- emits a tool-call trace (`tool.calls.jsonl` or equivalent),
- writes an authoritative attempt outcome (`feedback.json` or equivalent),
- provides an operator command to summarize an attempt from artifacts only (for example an `attempt explain` command).

## Timeout Semantics

ZeroContext has two timeout modes with different behavior:

- hard timeout:
  - kills the attempt process when timeout is hit,
  - may prevent follow-up feedback capture from the same process.
- soft timeout (recommended for discovery campaigns):
  - interrupt agent orchestration at timeout boundary (for example 120s),
  - then send a follow-up feedback prompt,
  - record outcome as `aborted_with_feedback`.

Use soft timeout for capability-gap discovery where post-attempt feedback is required.

## Prompting Guidance (Critical)

- Prefer short mission prompts over procedural step lists.
- Do not leak command names in mission prompts when testing discoverability.
- Keep task intent clear, but execution path open.
- Ask for CLI improvement in a follow-up turn, not in the initial mission prompt.
- Tell agents to use the traced CLI binary name: `surfwright`.
- Avoid bypassing the traced SurfWright surface for browser actions, or traces will be incomplete.

## Abort Procedure (Discovery Mode)

For one-agent-per-mission discovery runs:

1. Start mission prompt.
2. Wait until mission completes or 120s soft-timeout boundary is reached.
3. If still running at 120s, interrupt mission execution.
4. Immediately send follow-up feedback prompt.
5. Persist classification as `aborted_with_feedback` with trace artifacts.

## Report

Reporting is owned by ZCL. The key requirement for SurfWright is that reports remain trace-backed and comparable across runs.

## How To Evaluate Results

Per mission/attempt:

1. Inspect the tool-call trace JSONL:
   - attempted commands and order,
   - retries/loops,
   - non-zero status events.
2. Inspect attempt stdout/stderr logs (or equivalent captured outputs):
   - where reasoning diverged from available primitives,
   - whether failures were input mistakes vs capability gaps.
3. Inspect feedback (`feedback.json` or manual follow-up response):
   - decision tag,
   - proposed command name,
   - proposed usage,
   - proposed output shape.
4. Classify the gap:
   - `missing_primitive`,
   - `naming_ux`,
   - `output_shape`,
   - `already_possible_better_way`.
5. Prioritize by impact:
   - repeated demand across attempts,
   - high command count before block/success,
   - repeated non-retryable failure patterns.

## Required Run Metadata

For comparability across sessions, capture at minimum:

- mission id
- prompt file/version
- model/runtime identity (SurfWright baseline: `gpt-5.3-codex-spark`, locked as of 2026-02-16 unless explicitly overridden)
- git SHA (or commit ref)
- timeout policy (`hard` or `soft`)
- timeout threshold
- trace configuration (what is traced and how)
- timestamp/run id

## Notes

- Each attempt should use an isolated `SURFWRIGHT_STATE_DIR`, preventing stale cross-run state pollution.
