# ZeroContext Lab

ZeroContext Lab is an agent UX evaluation harness for cold-start behavior.
It is intentionally external to core SurfWright runtime behavior.

## Purpose

Use this when you want to measure what a fresh agent does on first contact:

- first-try success rate,
- command count to completion,
- runtime per task,
- recurring friction from agent feedback.
- missing-command demand based on real command attempts.
- architecture fit (new primitive vs better naming/output for existing primitives).

## What It Captures

Per attempt, the harness writes deterministic artifacts:

- `prompt.txt`: exact prompt fed to the agent command
- `agent.command.txt`: exact command that launched the agent
- `agent.stdout.log`, `agent.stderr.log`: transcript output
- `commands.jsonl`: shim-logged CLI invocations (`argv`, status, duration)
- `feedback.json`: parsed terminal feedback line (`ZCL_FEEDBACK:`)
- `run.json`: normalized run summary and task outcomes

`commands.jsonl` is the primary evidence of what the agent actually tried.
Agent self-reports are secondary.

## Trace Integrity Gate

Runs are valid only if browser actions are executed via the traced CLI binary (`surfwright` by default).

- valid: `surfwright --json ...`
- invalid for discovery evidence: wrapper/browser commands for browser actions (`pnpm dev -- ...`, direct Playwright scripts)

If wrappers are used for browser actions, `commands.jsonl` may be incomplete and the run should be marked invalid for discovery scoring.

## Two Evaluation Modes

### Mode A: Harness-native one-turn suite

Use `zcl:run` with task `expect` checks and optional inline feedback parsing.
Best for repeatable CI-style measurements.

### Mode B: Capability-gap two-turn subagent workflow

Use this when discovering missing CLI primitives/names/output shapes:

1. Send a sparse mission prompt (minimal instruction, no implementation hints).
2. Let the agent attempt the mission without coaching.
3. Send a follow-up prompt asking how the CLI should improve.
4. Evaluate with both:
   - follow-up proposal (`decision tag`, `missing command`, `usage`, `output shape`),
   - command evidence from `commands.jsonl`.

This mode is intentionally qualitative + evidence-backed. It is designed to reveal
natural command demand and where agents get stuck.

Keep campaign prompts/assets in a temporary workspace (for example `tmp/zero-context-gap/`) and exclude them from version control.

Follow-up response schema used in this repo:

```txt
DECISION_TAG=<missing_primitive|naming_ux|output_shape|already_possible_better_way>
MISSING_COMMAND=<dot.command.name>
PROPOSED_USAGE=<single usage line>
WHY_BETTER=<one sentence>
EXAMPLE_OUTPUT=<one-line minified JSON>
```

Decision tags:

- `missing_primitive`: no first-class command/flag cleanly solves the mission.
- `naming_ux`: capability exists, but command naming/shape makes discovery hard.
- `output_shape`: capability exists, but returned payload is not actionable/compact enough.
- `already_possible_better_way`: agent got stuck, but a good existing workflow already solves it.

## Suite Format

`schemaVersion` must be `1`.

```json
{
  "schemaVersion": 1,
  "name": "surfwright-smoke",
  "agentPreamble": "Optional preamble prepended to every task prompt.",
  "tasks": [
    {
      "id": "example-title",
      "prompt": "Open https://example.com and print TITLE=<title>",
      "expect": {
        "stdoutIncludes": ["TITLE=Example Domain"],
        "stdoutRegex": "TITLE=.*",
        "maxCliCommands": 8,
        "requireFeedback": true
      }
    }
  ]
}
```

## Run

Agent command template must include `{prompt_file}`.

```bash
pnpm -s build
pnpm zcl:run --suite test/fixtures/zerocontext-lab/surfwright-smoke.json --agent-cmd "codex exec --prompt-file {prompt_file}" --repeat 3 --label gpt-5
```

Useful placeholders in `--agent-cmd`:

- `{prompt_file}`
- `{task_id}`
- `{run_id}`
- `{attempt_id}`
- `{attempt_dir}`

## Timeout Semantics

ZeroContext has two timeout modes with different behavior:

- hard timeout (`zcl:run --timeout-ms <ms>`):
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
- Tell agents to use the traced CLI binary name (`surfwright` by default).
- Avoid wrapper/browser commands (`pnpm dev -- ...`, direct Playwright scripts) when collecting command-trace evidence, or traces will be incomplete.

## Abort Procedure (Discovery Mode)

For one-agent-per-mission discovery runs:

1. Start mission prompt.
2. Wait until mission completes or 120s soft-timeout boundary is reached.
3. If still running at 120s, interrupt mission execution.
4. Immediately send follow-up feedback prompt.
5. Persist classification as `aborted_with_feedback` with trace artifacts.

## Report

```bash
pnpm zcl:report --out-root .zerocontext-lab/runs
pnpm zcl:report --run .zerocontext-lab/runs/<run-id>/run.json --json
```

## How To Evaluate Results

Per mission/attempt:

1. Inspect `commands.jsonl`:
   - attempted commands and order,
   - retries/loops,
   - non-zero status events.
2. Inspect `agent.stdout.log` and `agent.stderr.log`:
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
- model/runtime identity
- git SHA (or commit ref)
- timeout policy (`hard` or `soft`)
- timeout threshold
- trace binary set
- timestamp/run id

## Notes

- The harness defaults to tracing `surfwright` via shim. Add extra traced binaries with repeated `--trace-bin <name>`.
- Each attempt gets an isolated `SURFWRIGHT_STATE_DIR`, preventing stale cross-run state pollution.
- For strict CI gating, add `--fail-on-fail`.
