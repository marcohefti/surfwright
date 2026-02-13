# SurfWright Agent Notes

This repo exists for one thing: a stable browser control surface that agents can drive without token bloat.

## What Stable Means

- Deterministic I/O: same input, same output shape.
- Composable primitives: small commands that chain.
- JSON-first: machine output is compact and predictable.
- Handle-based state: explicit `sessionId` and `targetId`, never implicit current-tab state.
- Typed failures: short `code` + `message` with no stacktrace noise by default.

## Start Here (First Open)

1. `docs/agent-guidance-architecture.md` for source-of-truth boundaries.
2. `docs/agent-dev-flow.md` for change routing and update decisions.
3. `docs/maintaining-agent-surface.md` for pre-merge and release checklist.
4. `docs/policy-harness.md` for structural rule framework and plug-in rules.
5. `docs/fixture-ingress-workflow.md` for adding regression fixtures when new edge cases appear.

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

## Validation Baseline

```bash
pnpm validate
pnpm test
pnpm skill:validate
```

## Commit Message Rule

- Always use Conventional Commits with an explicit scope.
- Format: `<type>(<scope>): <summary>`
- Example: `chore(docs): adding guidelines for maintenance`
