# SurfWright Agent Notes

This repo exists for one thing: a stable browser control surface that agents can drive without token bloat.

## What Stable Means

- Deterministic I/O: same input, same output shape.
- Composable primitives: small commands that chain.
- JSON-first: machine output is compact and predictable.
- Handle-based state: explicit `sessionId` and `targetId`, never implicit current-tab state.
- Typed failures: short `code` + `message` with no stacktrace noise by default.

## Start Here (First Open)

1. `ARCHITECTURE.md` for the one-screen architecture map.
2. `docs/architecture.md` for the deep dive index (subsystem notes with file pointers).
3. `docs/agent-guidance-architecture.md` for boundary rules (compat shim; stay short).
4. `docs/agent-dev-flow.md` for change routing and update decisions.
5. `docs/maintaining-agent-surface.md` for pre-merge and release checklist.
6. `docs/policy-harness.md` for structural rule framework and plug-in rules.
7. `docs/fixture-ingress-workflow.md` for adding regression fixtures when new edge cases appear.
8. `docs/zerocontext-lab.md` for unbiased cold-start subagent evaluation workflow.
9. `docs/zerocontext-gap-workflow.md` for one-agent-per-mission capability-gap discovery and evaluation.
10. `docs/release-governance.md` for locked release/update policy and required checks.
11. `docs/contributor-release-routing.md` for release/docs/changelog routing rules.

## Runtime Source of Truth

Use this command whenever behavior may have changed:

```bash
surfwright --json contract
```

## Change Routing

- Changing user-facing CLI behavior:
  follow `docs/agent-dev-flow.md` behavior path.
- Changing maintainer process/policy:
  update `docs/agent-dev-flow.md` and/or `docs/maintaining-agent-surface.md`.
- Changing runtime agent guidance:
  update `skills/surfwright/SKILL.md` or `skills/surfwright/references/*`.
- Adding automation:
  use `docs/agent-dev-flow.md` script gate to decide `scripts/` vs `skills/surfwright/scripts/`.
- Changing release/publish/update policy:
  update `docs/release-governance.md` and route contributor instructions via `docs/contributor-release-routing.md`.
- Changing update command behavior:
  update `docs/update-lifecycle.md` plus `README.md` update section.
- Changing skill compatibility/update flow:
  update `docs/skills-lifecycle.md`, `skills/surfwright/skill.json`, and `skills/surfwright.lock.json`.

## Validation Baseline

```bash
pnpm validate
pnpm test
pnpm skill:validate
```

## Agent-First Execution Rule

Treat all feature work, refactors, and optimizations as agent-operator surface design:

- Primary goal: make answers and actions resourceful for agents (high signal, low token cost, deterministic JSON).
- Always evaluate both `operator UX` and `agent UX`: obvious flows, minimal steps, explicit handles, low friction.
- Speed is a first-class constraint. Prefer faster command paths and bounded outputs over verbose diagnostics.
- Do not increase timeouts as a first fix. If a command times out under defaults, treat it as a bug and debug root cause (session state/CDP reachability/startup race); only use longer timeouts for explicitly labeled diagnostics, never as the solution.
- Do not rely on assumptions when evaluating behavior. Agents should run scripts and gather runtime evidence directly.
- Playwright is an expected verification tool in this repo. Agents may run focused Playwright scripts to inspect behavior (including network/perf/websocket behavior) and propose concrete CLI improvements from those findings.
- When proposing/implementing changes, include how the change improves:
  - agent comfort (composability + deterministic parsing),
  - operational speed (runtime/iteration latency),
  - quality of answers the agent can generate from CLI output.

## ZeroContext Trigger

When the user asks to "spawn agents", "zero context test", or evaluate fresh-agent intuition:

- Use the ZeroContext Lab workflow in `docs/zerocontext-lab.md` (do not invent an ad-hoc process).
- For capability-gap discovery, follow `docs/zerocontext-gap-workflow.md` (sparse mission prompts, 120s soft timeout, follow-up feedback, trace-first evaluation).
- Keep task prompts short and unbiased; do not leak implementation hints or feature names unless explicitly requested.
- Ensure runs are trace-backed (captured command artifacts/logs), then evaluate from those artifacts first.
- Prefer evidence-based scoring: success/failure, command count, typed failures, and where agents got stuck.
- Treat agent self-reports as secondary; ground conclusions in ZeroContext outputs (tool-call trace JSONL, run artifacts, report).

## Commit Message Rule

- Always use Conventional Commits with an explicit scope.
- Format: `<type>(<scope>): <summary>`
- Example: `chore(docs): adding guidelines for maintenance`

## Documentation + Changelog Routing (Mandatory)

- User-facing behavior changes must update docs and changelog in the same change set.
- Routing baseline:
  - `README.md` for install/availability/command UX.
  - `CHANGELOG.md` (`[Unreleased]`) for every user-visible delta.
  - `docs/release-governance.md` for release/update/policy changes.
  - `docs/contributor-release-routing.md` for maintenance routing/process changes.
- If docs and behavior diverge, treat it as a blocking defect and fix immediately.
