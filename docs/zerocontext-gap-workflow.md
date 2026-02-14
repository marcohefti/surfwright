# ZeroContext Gap Workflow

This playbook defines the standard process for SurfWright capability-gap discovery.
It is optimized for one-agent-per-mission evaluation with trace-backed evidence.

Use this together with `docs/zerocontext-lab.md`.

## Goal

For each mission, determine whether the observed friction indicates:

- a missing primitive,
- a naming/discoverability issue,
- an output contract issue,
- or an already-possible workflow that agents failed to find.

## Inputs

Prepare a temporary campaign workspace (example: `tmp/zero-context-gap/`) containing:

- mission prompts (`prompts/*.txt`)
- follow-up prompt (`followup-feedback.txt`)
- mission index (`missions.json`)
- local fixtures/assets (`assets/*`)

Do not version control campaign artifacts.

## One-Agent-Per-Mission Procedure

1. Start one fresh agent with one mission prompt.
2. Do not coach during mission execution.
3. Use a 120-second soft timeout boundary.
4. If the mission has not completed by 120 seconds, interrupt mission execution.
5. Send follow-up prompt asking how the CLI should improve (natural language).
6. If the follow-up is vague or lacks a concrete proposal, send a second follow-up asking for one concrete change (name + usage + one-line example JSON).
7. Collect:
   - follow-up response(s),
   - trace artifacts (`commands.jsonl`, stdout/stderr logs).
8. Classify outcome and record decision tag.

## Timeout Policy

- preferred: soft timeout with follow-up (`aborted_with_feedback`)
- avoid for discovery: hard process kill without follow-up

Hard kill is acceptable for CI guardrails, but not for command-design discovery.

## Trace Policy

Browser actions must use `surfwright` directly.

- acceptable: `surfwright --json open https://example.com`
- not acceptable for discovery evidence: `pnpm dev -- ...` for browser actions

If mission actions bypass the traced binary, mark run invalid for discovery scoring.

## Follow-Up Prompt Policy

Default: ask for a natural-language proposal.

Prefer the agent includes:

- what they tried and where they got stuck
- one concrete SurfWright improvement (missing primitive, naming, output shape, or “document existing”)
- an example usage line and one-line example JSON output (when possible)

If you need a machine-parsed summary, request exactly one trailing line prefixed by `ZCL_FEEDBACK:` followed by JSON.

## Decision Tag Rubric

- `missing_primitive`
  - The mission cannot be completed cleanly with existing first-class commands.
- `naming_ux`
  - Capability exists, but command naming/shape prevents discoverability.
- `output_shape`
  - Capability exists, but payload fields are insufficient/noisy/ambiguous.
- `already_possible_better_way`
  - Existing command path is adequate; friction came from exploration, not missing surface.

## Evaluation Priority

1. `commands.jsonl` (ground truth of what was attempted)
2. `agent.stdout.log` and `agent.stderr.log`
3. follow-up proposal text

## Record Per Mission

- mission id
- run id and timestamp
- completion state (`success`, `blocked`, `aborted_with_feedback`)
- command count
- failed command count
- decision tag
- proposed command name/usage/output
- concise evaluator note

## Output

Generate one summary table per batch:

- mission id
- decision tag
- proposed command
- confidence (human evaluator)
- implementation recommendation (`build`, `rename`, `reshape-output`, `document-existing`)
