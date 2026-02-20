# ZeroContext Run Log Template

This file is a template only.

Do not commit campaign-specific run histories to versioned docs.
Store each campaign ledger in unversioned routine space:

- `tmp/zcl/<routine-id>/RUN_LOG.MD`

Routine artifacts remain under:

- `tmp/zcl/<routine-id>/data/`

## Entry Template

```md
## YYYY-MM-DD - <campaign label>

- Objective: <one sentence>
- Suite ID: `<suite-id>`
- Routine Path: `tmp/zcl/<routine-id>/`
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
