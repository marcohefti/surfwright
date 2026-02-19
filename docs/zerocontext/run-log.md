# ZeroContext Run Log

This is the canonical ledger for SurfWright ZeroContext campaigns.
Append-only. Newest entry first.

## Entry Template

```md
## YYYY-MM-DD - <campaign label>

- Objective: <one sentence>
- Suite ID: `<suite-id>`
- Run IDs: `<run-id-1>`, `<run-id-2>`
- Runner: `<runner command>`
- Model: `<model>`
- Command:
  - `<zcl suite run ...>`
- Artifacts:
  - `.zcl/runs/<run-id>/suite.json`
  - `.zcl/runs/<run-id>/run.json`
  - `.zcl/runs/<run-id>/attempts/*/{attempt.report.json,feedback.json,tool.calls.jsonl,runner.stderr.log}`
- Outcome:
  - Attempts started: `<n>`
  - Attempts finalized: `<n>`
  - Successes: `<n>`
  - Dominant failures: `<code histogram>`
  - Notable behavior: `<1-2 bullets>`
- Decision:
  - `<what we will change>`
- Next run guardrails:
  - `<concrete command/prompt/timeout/shim guardrails>`
```

## 2026-02-19 - Pinned Repos Rerun (stability failure)

- Objective: rerun 10-attempt pinned-repo extraction campaign with feedback/note capture.
- Suite ID: `surfwright-pinned-repos-feedback-rerun-v4`
- Run IDs: `20260219-110339Z-6deec7` (aborted)
- Runner: `tmp/zcl/runner-codex-zcl-v2.sh` (`gpt-5.3-codex-spark`)
- Command:
  - `zcl suite run --file tmp/zcl/surfwright-pinned-repos-feedback-rerun-v4.yaml --session-isolation process --parallel 1 --timeout-ms 240000 --timeout-start attempt_start --shim surfwright --capture-runner-io --json -- tmp/zcl/runner-codex-zcl-v2.sh`
- Artifacts:
  - `.zcl/runs/20260219-110339Z-6deec7/suite.json`
  - `.zcl/runs/20260219-110339Z-6deec7/run.json`
  - `.zcl/runs/20260219-110339Z-6deec7/attempts/001-run-01-r1/attempt.report.json`
  - `.zcl/runs/20260219-110339Z-6deec7/attempts/002-run-02-r1/tool.calls.jsonl`
  - `.zcl/runs/20260219-110339Z-6deec7/attempts/00*-run-*-r1/runner.stderr.log`
- Outcome:
  - Attempts started: `6/10`
  - Attempts finalized: `1/10`
  - Successes: `0`
  - Dominant failures: `ZCL_E_TOOL_FAILED`, `ZCL_E_SPAWN`, repeated exit `137` / `Killed: 9`
  - Notable behavior: run-01 produced 453 repeated failed tool calls; run-02 produced 354 repeated failed tool calls with empty stdout/stderr captures.
- Decision:
  - Treat this campaign as invalid for product scoring (runtime instability contaminated results).
  - Fix orchestration/runtime stability first, then rerun from clean state.
- Next run guardrails:
  - Keep shim first in `PATH`; never shadow it with direct tool wrappers.
  - Validate `zcl --version` and shimmed `surfwright --version` in a preflight step before mission start.
  - Fail fast and finalize attempt when spawn/runtime kills are detected; do not retry hundreds of times.

## 2026-02-19 - Pinned Repos Baseline (completed reference)

- Objective: 10-attempt pinned-repo extraction and improvement feedback (reference campaign).
- Suite ID: `surfwright-pinned-repos-feedback`
- Run IDs: `20260219-090001Z-a1b2c3`
- Runner: `tmp/zcl/runner-codex-zcl.sh` (`gpt-5.3-codex-spark`)
- Artifacts:
  - `.zcl/runs/20260219-090001Z-a1b2c3/run.json`
  - `.zcl/runs/20260219-090001Z-a1b2c3/attempts/*/attempt.report.json`
  - `.zcl/runs/20260219-090001Z-a1b2c3/attempts/*/feedback.json`
  - `.zcl/runs/20260219-090001Z-a1b2c3/attempts/*/notes.jsonl`
- Outcome:
  - Attempts finalized: `10/10`
  - Feedback present: `9/10` (one timeout/missing feedback)
  - Successful attempts: `9/10`
  - Average command count: `17` (min `7`, max `37`)
  - Pinned repo extraction: mostly `4` correct repos, with `openai/codex` false-positive in `3` attempts.
- Decision:
  - Prioritize first-class pinned-repo extraction shape or stronger link filtering primitives.
  - Reduce false positives by exposing stable profile-card scoped extraction output.
