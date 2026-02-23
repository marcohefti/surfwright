# Agent Dev Flow

Use this document to decide what to update when changing SurfWright.

## Goal

Keep code behavior, runtime skill guidance, and maintainer docs synchronized with minimal drift and minimal token overhead.
Prefer clean-slate evolution over compatibility layering: remove obsolete surface area instead of keeping deprecated aliases.

## Agent-First Evaluation Rule

For feature work, refactors, and optimizations, default to an evidence-first loop run by the agent:

1. Execute focused scripts/commands (Playwright allowed and expected) to observe real behavior.
2. Prefer CLI/API shapes that maximize agent parseability and minimize token/runtime overhead.
3. Evaluate proposals by three explicit outcomes:
   - higher agent/operator workflow clarity,
   - faster execution and iteration speed,
   - better answer quality from bounded machine output.

## First-Open Workflow (for an agent)

1. Read `AGENTS.md` for repo intent and routing.
2. Read `docs/agent-guidance-architecture.md` for source-of-truth boundaries.
3. Read this file for update decisions.
4. If behavior is involved, inspect current runtime contract:

```bash
surfwright contract --search <term>
```

## Change Classification

Use this matrix before editing docs/skills.

| Change type | Must update | Usually update | Usually no change |
|---|---|---|---|
| Command added/removed/renamed | feature `manifest.ts` + `register-commands.ts`, contract tests/snapshot, `README.md` commands section, skill bootstrap | `docs/maintaining-agent-surface.md` if process changed | `AGENTS.md` unless routing changed |
| Flag/default/timeout semantic change | contract payload if user-facing, tests, skill bootstrap | `README.md` examples | architecture docs |
| Output JSON shape change | contract payload, tests, skill bootstrap rules that parse/use fields | `README.md` examples | unrelated docs |
| Error code or retryability change | contract payload, tests, skill bootstrap failure-routing rule | `README.md` typed error examples | `AGENTS.md` |
| New edge case discovered in real browser run | ingress fixture + integration test, `docs/fixture-ingress-workflow.md` | `README.md` examples if user-visible | contract payload unless behavior changed |
| Internal refactor with no behavior change | tests if coverage shifts | docs only if architecture/process changed | skill bootstrap |
| New operator troubleshooting workflow | `docs/*.md` | `README.md` if common | contract payload |
| Dev process change (how we maintain) | `docs/maintaining-agent-surface.md` or this file | `AGENTS.md` routing section | skill bootstrap |

## Decision Rules: `docs/` vs `skills/` vs scripts

### Create/update `docs/*.md` when

- Audience is human maintainer or contributor.
- Content is about architecture, process, release discipline, or repository policy.
- The information is not required at runtime for an agent to execute CLI tasks.

### Create/update `skills/surfwright/SKILL.md` when

- Invocation conditions change.
- Core operating loop or mandatory guardrails change.

Keep this file concise and procedural.

### Create script in `skills/surfwright/scripts/` when

- Runtime agents repeatedly execute a deterministic multi-step procedure.
- Reliability benefits from executable logic over prose.
- The script is skill-scoped and useful outside this repository's development workflow.

### Create script in `scripts/` when

- The script is for repository maintenance, CI checks, packaging, or local developer tooling.
- The script is not needed by runtime agents during normal product usage.

## Script Addition Gate

Before adding a new script (repo or skill), answer yes to at least two:

1. This logic has been repeated manually in at least two PRs/tasks.
2. Human prose instructions have caused mistakes or drift.
3. Deterministic output is required for automation.
4. The script meaningfully reduces context/token cost in repeated runs.

If fewer than two are true, prefer documentation over new script surface.

## Definition of Done by change category

### Behavior-affecting change

1. Update code.
2. Update `surfwright contract` producer if user-facing behavior changed.
3. Update tests.
4. Update runtime skill bootstrap (`skills/surfwright/SKILL.md`) used by runtime agents.
5. Update `README.md` examples if user-visible flows changed.
6. Run validation commands.

### Agent-guidance and efficiency change

1. Keep `skills/surfwright/SKILL.md` concise and protocol-only.
2. Ensure SKILL instructions remain contract-first (`contract --search`) and avoid broad `--help` discovery.
3. Validate guidance shape with `pnpm skill:validate`.
4. For ZCL browser-control runs, enforce attempt budgets with:

```bash
pnpm zcl:efficiency:check --run <runDir>
```

5. For iterative SurfWright optimization, run one mission-scoped campaign per change and update the result sheet:

```bash
pnpm bench:loop:run --mode optimize --label exp-1 --mission-id 018-infinite-scroll-chunks --hypothesis "<why>" --change "<what changed>"
pnpm bench:loop:history --mission-id 018-infinite-scroll-chunks
```

Iteration meaning is strict: optimize by default (`change -> run -> evaluate`). Use `--mode sample` only when explicit variance sampling is requested.
Set parallel run fan-out with `agentsPerMission` in `bench/agent-loop/config.json` (or `--agents-per-mission`) when one mission should be sampled by multiple fresh agents in one run.

### Bugfix TDD loop (recommended)

When fixing a bug or regression, default to the TDD workflow:

1. Reproduce with `surfwright` (JSON output is default) and capture the smallest failing command sequence.
2. Add a failing test in the smallest lane that can guard the regression:
   - hermetic `test/*.contract.test.mjs` when possible
   - otherwise `test/browser/**/*.browser.mjs` (prefer deterministic `data:` pages)
   - ingress fixtures only when you cannot get a deterministic repro
3. Fix the root cause and make the test pass.
4. Run `pnpm -s smoke` for fast operator-surface sanity.

See `docs/bugfix-tdd-workflow.md`.

### Process-only change

1. Update `docs/*.md`.
2. Update `AGENTS.md` routing if discoverability changed.
3. Run relevant lightweight checks.

### Edge-case fixture addition (no behavior change)

1. Add fixture per `docs/fixture-ingress-workflow.md`.
2. Add/extend integration test that consumes the fixture.
3. Confirm fixture does not encode volatile/raw Playwright internals.
4. Run validation commands.

## Validation Commands

Preferred single-pass (sequential, avoids build race between separate processes):

```bash
pnpm verify
```

Equivalent explicit sequence:

```bash
pnpm test
pnpm validate
pnpm contract:snapshot:check
```

For release confidence, also run:

```bash
surfwright contract
surfwright open https://example.com
surfwright target snapshot <targetId>
```

## Drift Policy

- Runtime contract + tests are authoritative for machine behavior.
- Runtime skill bootstrap must reflect current contract semantics.
- If docs disagree with code, fix docs in the same change window.

## Policy Rules

- Structural rule framework lives in `docs/policy-harness.md`.
- Add rules via `policy/rules/*` + `policy/rules/index.mjs` + `policy/config.json`.
