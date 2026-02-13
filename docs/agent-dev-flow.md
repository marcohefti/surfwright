# Agent Dev Flow

Use this document to decide what to update when changing SurfWright.

## Goal

Keep code behavior, runtime skill guidance, and maintainer docs synchronized with minimal drift and minimal token overhead.

## First-Open Workflow (for an agent)

1. Read `AGENTS.md` for repo intent and routing.
2. Read `docs/agent-guidance-architecture.md` for source-of-truth boundaries.
3. Read this file for update decisions.
4. If behavior is involved, inspect current runtime contract:

```bash
surfwright --json contract
```

## Change Classification

Use this matrix before editing docs/skills.

| Change type | Must update | Usually update | Usually no change |
|---|---|---|---|
| Command added/removed/renamed | `src/core/usecases.ts` contract payload, tests, `README.md` commands section, skill workflow reference | `docs/maintaining-agent-surface.md` if process changed | `AGENTS.md` unless routing changed |
| Flag/default/timeout semantic change | contract payload if user-facing, tests, skill workflow reference | `README.md` examples | architecture docs |
| Output JSON shape change | contract payload, tests, skill references that parse/use fields | `README.md` examples | unrelated docs |
| Error code or retryability change | contract payload, tests, `skills/surfwright/references/error-handling.md` | `README.md` typed error examples | `AGENTS.md` |
| Internal refactor with no behavior change | tests if coverage shifts | docs only if architecture/process changed | skill refs |
| New operator troubleshooting workflow | skill references | `README.md` if common | contract payload |
| Dev process change (how we maintain) | `docs/maintaining-agent-surface.md` or this file | `AGENTS.md` routing section | skill references |

## Decision Rules: `docs/` vs `skills/` vs scripts

### Create/update `docs/*.md` when

- Audience is human maintainer or contributor.
- Content is about architecture, process, release discipline, or repository policy.
- The information is not required at runtime for an agent to execute CLI tasks.

### Create/update `skills/surfwright/references/*.md` when

- Audience is runtime agent using the shipped CLI.
- Content improves action quality in active loops (workflows, error handling, retry policy, runbooks).
- Details are too specific/long for `SKILL.md` but should be discoverable by the skill.

### Create/update `skills/surfwright/SKILL.md` when

- Invocation conditions change.
- Core operating loop or mandatory guardrails change.
- Reference map changes.

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
2. Update `surfwright --json contract` producer if user-facing behavior changed.
3. Update tests.
4. Update skill references used by runtime agents.
5. Update `README.md` examples if user-visible flows changed.
6. Run validation commands.

### Process-only change

1. Update `docs/*.md`.
2. Update `AGENTS.md` routing if discoverability changed.
3. Run relevant lightweight checks.

## Validation Commands

```bash
pnpm validate
pnpm test
pnpm skill:validate
```

For release confidence, also run:

```bash
surfwright --json contract
surfwright --json session ensure
surfwright --json open https://example.com
```

## Drift Policy

- Runtime contract + tests are authoritative for machine behavior.
- Skill references must reflect current contract semantics.
- If docs disagree with code, fix docs in the same change window.

## Policy Rules

- Structural rule framework lives in `docs/policy-harness.md`.
- Add rules via `policy/rules/*` + `policy/rules/index.mjs` + `policy/config.json`.
