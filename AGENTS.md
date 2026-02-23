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
8. `docs/bugfix-tdd-workflow.md` for the reproduce-test-fix loop (TDD) when you hit regressions.
9. `docs/release-governance.md` for locked release/update policy and required checks.
10. `docs/contributor-release-routing.md` for release/docs/changelog routing rules.
11. `docs/policy/feature-recommendation-groundrules.md` for mandatory recommendation/evaluation scope rules.
12. `docs/campaigns/browser-control-zcl-native.md` for the versioned native ZCL campaign workflow (20 browser-control missions).

## Runtime Source of Truth

Use this command whenever behavior may have changed:

```bash
surfwright contract
```

## Change Routing

- Changing user-facing CLI behavior:
  follow `docs/agent-dev-flow.md` behavior path.
- Changing maintainer process/policy:
  update `docs/agent-dev-flow.md` and/or `docs/maintaining-agent-surface.md`.
- Changing runtime agent guidance:
  update `skills/surfwright/SKILL.md` (runtime guidance stays in this single file).
- Adding automation:
  use `docs/agent-dev-flow.md` script gate to decide `scripts/` vs `skills/surfwright/scripts/`.
- Changing release/publish/update policy:
  update `docs/release-governance.md` and route contributor instructions via `docs/contributor-release-routing.md`.
- Changing update command behavior:
  update `docs/lifecycle/update-lifecycle.md` plus `README.md` update section.
- Changing skill compatibility/update flow:
  update `docs/skills-lifecycle.md`, `skills/surfwright/skill.json`, and `skills/surfwright.lock.json`.
- Changing recommendation/evaluation guardrails:
  update `docs/policy/feature-recommendation-groundrules.md` and this `AGENTS.md` trigger section together.
- Changing ZeroContext/ZCL browser-control campaign setup:
  update `docs/campaigns/browser-control-native-codex.yaml` + `docs/campaigns/browser-control-zcl-native.md` in the same change window.
- Changing browser-control mission prompt/oracle assets for exam-mode ZCL runs:
  update `missions/browser-control/*.md`, regenerate `missions/browser-control/prompts/*` + `missions/browser-control/oracles/*` via `scripts/zcl/build-browser-control-exam-pack.mjs`, and keep `scripts/zcl/eval-browser-control-oracle.mjs` aligned with oracle schema.

## Validation Baseline

```bash
pnpm validate
pnpm test
pnpm skill:validate
```

## Dev Auto-Sync (Optional, Recommended)

For active development, you can install local git hooks that keep your workstation's `surfwright`
CLI + Codex skill synced on commit/push:

```bash
pnpm dev:install-git-hooks
```

## Agent-First Execution Rule

Treat all feature work, refactors, and optimizations as agent-operator surface design:

- Primary goal: make answers and actions resourceful for agents (high signal, low token cost, deterministic JSON).
- Always evaluate both `operator UX` and `agent UX`: obvious flows, minimal steps, explicit handles, low friction.
- Speed is a first-class constraint. Prefer faster command paths and bounded outputs over verbose diagnostics.
- Clean-slate surface policy: do not keep deprecated aliases, compatibility shims, or dual field names in CLI/runtime payloads. If a shape is obsolete, remove it and update tests/docs/skill references in the same change window.
- Do not increase timeouts as a first fix. If a command times out under defaults, treat it as a bug and debug root cause (session state/CDP reachability/startup race); only use longer timeouts for explicitly labeled diagnostics, never as the solution.
- Do not rely on assumptions when evaluating behavior. Agents should run scripts and gather runtime evidence directly.
- Playwright is an expected verification tool in this repo. Agents may run focused Playwright scripts to inspect behavior (including network/perf/websocket behavior) and propose concrete CLI improvements from those findings.
- When proposing/implementing changes, include how the change improves:
  - agent comfort (composability + deterministic parsing),
  - operational speed (runtime/iteration latency),
  - quality of answers the agent can generate from CLI output.

## Recommendation Trigger (Mandatory)

When the user asks for adjustments, new features, optimizations, evaluations, or recommendations about what to change:

- Load and apply `docs/policy/feature-recommendation-groundrules.md` before proposing changes.
- Treat that file as a blocking scope gate (not optional guidance).
- Reject page-specific and "kind-of-page" optimizations; replace with generic surface proposals.
- In the response, include a short "groundrules compliance check" that confirms:
  - page-specific optimization avoided,
  - kind-of-page optimization avoided,
  - cross-site benefit explained,
  - evidence cited.

## ZeroContext Trigger

When the user asks to "spawn agents", "zero context test", or evaluate fresh-agent intuition:

- Use fresh subagent sessions; do not reuse the same session across missions.
- Store all ZeroContext campaign artifacts in unversioned routine-scoped paths under `tmp/zerocontext/<routine-id>/`.
- ZeroContext evaluation model baseline (unless the user overrides): `gpt-5.3-codex-spark` (locked as of 2026-02-16), with `medium` reasoning effort when supported.
- Keep task prompts short and unbiased; do not leak implementation hints or feature names unless explicitly requested.
- Ensure runs are trace-backed (captured command artifacts/logs), then evaluate from those artifacts first.
- Prefer evidence-based scoring: success/failure, command count, typed failures, and where agents got stuck.
- Treat agent self-reports as secondary; ground conclusions in run outputs (tool-call trace JSONL, run artifacts, report).
- Use `docs/campaigns/browser-control-zcl-native.md` as the baseline runbook for the versioned 20-mission browser-control campaign.
- For multi-mission comparisons, enforce one fresh subagent per `flow+mission`; never reuse a session across missions.
- Keep a hard concurrency cap of `6` live subagents unless the user explicitly overrides it.
- Do not replace zero-context discovery with scripted mission solvers; mission completion should come from fresh subagents, not hardcoded pipelines.

### Benchmark Loop Iteration Contract

When running the SurfWright benchmark loop (`bench/agent-loop/*`, `pnpm bench:loop:run`):

- Treat "iteration" as an optimize iteration by default.
- Optimize iteration means: one concrete change, one run, then artifact-based evaluation before the next change.
- Do not reinterpret requested iteration counts as no-change variance sampling.
- Use `--mode sample` only when the operator explicitly asks for baseline/variance samples.
- Treat `agentsPerMission` as the per-run parallel fan-out knob (one fresh agent per `flow+mission` attempt); honor config or explicit CLI override.
- Run loop work on a dedicated feature branch (never directly on `main`) so iteration commits stay traceable.
- For optimize iterations, keep one commit per evaluated change and include scope/iteration context in commit messages.

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
