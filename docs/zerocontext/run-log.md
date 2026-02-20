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

## 2026-02-20 - Social Compare Rerun (14 explorer agents, progressive rounds)

- Objective: rerun 7 common browser-agent missions for SurfWright vs Chrome MCP with one fresh explorer agent per mission per flow, then regenerate social comparison artifacts.
- Suite ID: `social-compare-surfwright-7` + `social-compare-chrome-mcp-7` (single-mission runs, 14 total attempts)
- Run IDs: SurfWright `20260220-141001Z-1fcbd7`, `20260220-141018Z-18726c`, `20260220-141044Z-9c6d54`, `20260220-141119Z-8a2ab0`, `20260220-141139Z-7bef28`, `20260220-141203Z-06e29c`, `20260220-141245Z-b04c4f`; Chrome MCP `20260220-140955Z-0e2fae`, `20260220-141019Z-d41a88`, `20260220-141045Z-143809`, `20260220-141117Z-0352a4`, `20260220-141140Z-9f148a`, `20260220-141203Z-f2884e`, `20260220-141247Z-8519de`
- Runner: per-mission wrappers `tmp/zcl/run_social_compare_surfwright_one.sh <mission-id>` and `tmp/zcl/run_social_compare_chrome_mcp_one.sh <mission-id>` invoked by explorer subagents
- Model: `gpt-5.3-codex-spark` (Codex explorer agents)
- Command:
  - `tmp/zcl/run_social_compare_surfwright_one.sh <mission-id>`
  - `tmp/zcl/run_social_compare_chrome_mcp_one.sh <mission-id>`
- Artifacts:
  - `tmp/zcl/SOCIAL_COMPARE_RESULTS_LATEST.md`
  - `tmp/zcl/SOCIAL_COMPARE_EXECUTION_LATEST.md`
  - `tmp/zcl/SOCIAL_COMPARE_X_POST_PACK_LATEST.md`
  - `tmp/zcl/SOCIAL_COMPARE_14AGENTS_RUNMAP_20260220.md`
  - `.zcl/runs/<run-id>/attempts/001-<mission>-r1/{attempt.report.json,feedback.json,tool.calls.jsonl}`
- Outcome:
  - Attempts started/finalized: `14/14`
  - Successes: `14/14` (`7/7` per flow)
  - Aggregate turns: SurfWright `21` vs Chrome MCP `48`
  - Aggregate wall time: SurfWright `23.1s` vs Chrome MCP `32.3s`
  - Aggregate token estimate: SurfWright `4549` vs Chrome MCP `40335`
  - Notable behavior: first-pass orientation wall time was near parity in this rerun (`2.6s` SW vs `2.6s` CH), but token delta remained large (`615` vs `5729`).
- Decision:
  - Keep using these 7 missions as social-proof baseline; they map to recognizable daily use cases.
  - Keep reporting all three efficiency axes together: turns, wall time, tokens.
- Next run guardrails:
  - Maintain progressive rounds (do not start next round until prior Chrome MCP mission is finished).
  - Keep one mission per fresh agent per flow (no multi-mission carryover).
  - Preserve trace-backed evidence paths in run map + per-attempt artifacts.

## 2026-02-20 - SurfWright Qualitative Feedback Rerun (7 common missions)

- Objective: rerun common web-agent missions on SurfWright-only and collect explicit qualitative improvement notes from each mission.
- Suite ID: `surfwright-qual-feedback-<mission>` (one mission per run, 7 runs total)
- Run IDs: `20260220-133201Z-72f4de`, `20260220-133201Z-7726ab`, `20260220-133201Z-3a5b38`, `20260220-133203Z-58b121`, `20260220-133202Z-57e119`, `20260220-133202Z-9a5a9f`, `20260220-133330Z-239178`
- Runner: `tmp/zcl/runner-codex-zcl-v2.sh` (`gpt-5.3-codex-spark`) orchestrated via `tmp/zcl/run_surfwright_qual_feedback_one.sh <mission-id>`
- Model: `gpt-5.3-codex-spark`
- Command:
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh docs-install-command`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh homepage-pricing`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh redirect-evidence`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh first-pass-orientation`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh modal-lifecycle`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh multimatch-disambiguation`
  - `tmp/zcl/run_surfwright_qual_feedback_one.sh style-inspection`
- Artifacts:
  - `tmp/zcl/SURFWRIGHT_QUAL_FEEDBACK_RESULTS_20260220.md`
  - `tmp/zcl/SURFWRIGHT_QUAL_FEEDBACK_RUNMAP_20260220.md`
  - `.zcl/runs/<run-id>/attempts/*/{attempt.report.json,feedback.json,notes.jsonl,tool.calls.jsonl,runner.stderr.log}`
- Outcome:
  - Attempts started/finalized: `7/7`
  - Successes: `7/7`
  - Total tool calls: `75`
  - Dominant decision tags from notes: `output_shape (5)`, `missing_primitive (2)`
  - Notable behavior: style mission discovered and used the new `target style` command; most feedback requested additive output-shape ergonomics, not hard blockers.
- Decision:
  - Prioritize additive output-shape improvements next (`docs command/code extraction`, orient counters, optional click proof count-after evidence).
  - Keep current generic command surface (avoid site-specific shortcuts).
- Next run guardrails:
  - Keep finish rule explicit: execute `zcl feedback` and `zcl note` as shell commands, not prose.
  - Keep mission prompts generic and non-site-optimized for product decisions.
  - Continue one-agent-per-mission isolation.

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
