# ZeroContext Lab

ZeroContext Lab is an agent UX evaluation harness for cold-start behavior.
It is intentionally external to core SurfWright runtime behavior.

## Purpose

Use this when you want to measure what a fresh agent does on first contact:

- first-try success rate,
- command count to completion,
- runtime per task,
- recurring friction from agent feedback.

## What It Captures

Per attempt, the harness writes deterministic artifacts:

- `prompt.txt`: exact prompt fed to the agent command
- `agent.command.txt`: exact command that launched the agent
- `agent.stdout.log`, `agent.stderr.log`: transcript output
- `commands.jsonl`: shim-logged CLI invocations (`argv`, status, duration)
- `feedback.json`: parsed terminal feedback line (`ZCL_FEEDBACK:`)
- `run.json`: normalized run summary and task outcomes

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

## Report

```bash
pnpm zcl:report --out-root .zerocontext-lab/runs
pnpm zcl:report --run .zerocontext-lab/runs/<run-id>/run.json --json
```

## Notes

- The harness defaults to tracing `surfwright` via shim. Add extra traced binaries with repeated `--trace-bin <name>`.
- Each attempt gets an isolated `SURFWRIGHT_STATE_DIR`, preventing stale cross-run state pollution.
- For strict CI gating, add `--fail-on-fail`.
