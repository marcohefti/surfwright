# Agent Guidance Architecture

This repository serves two distinct consumers:

1. Development agents/operators working inside the repo.
2. Runtime agents driving the shipped `surfwright` CLI.

To keep both fast and maintainable, we separate guidance into explicit layers with one source of truth per layer.

## Source-of-truth map

- Runtime contract (machine): `surfwright --json contract`
- Runtime behavior (verification): `test/*.contract.test.mjs` (core + feature suites)
- Product/developer narrative (human): `README.md`, `AGENTS.md`, `docs/*.md`
- Installed skill for active usage: `skills/surfwright/`

## Storage model

- `src/`: executable behavior only.
- `src/core/`: bounded runtime domains (`session/`, `state/`, `shared/`, `target/`, `daemon/`); top-level core files are stable boundaries/facades only.
- `src/features/<feature>/`: feature packages with `commands/`, `usecases/`, `domain/`, `infra/` entrypoints.
- `docs/`: maintainer-facing architecture and update procedures.
- `skills/surfwright/`: Codex skill package for runtime invocation.
- `scripts/`: install/validate automation for skills.

## Design rules

1. Command contracts are manifest-driven. Update feature command specs and derive `surfwright --json contract` from those specs.
2. `src/cli.ts` is orchestration-only: global flags, worker mode, and feature registration. Command behavior belongs in feature packages.
3. State upgrades are explicit and versioned in `src/core/state/migrations.ts`; no implicit schema upgrades in ad-hoc call sites.
4. Keep `skills/surfwright/SKILL.md` concise and procedural; push detail to `skills/surfwright/references/*`.
5. Keep docs for humans in `docs/`; avoid auxiliary docs inside skill directories.
6. Any new/changed error code must be reflected in:
   - `src/core/contracts/error-contracts.ts`
   - `skills/surfwright/references/error-handling.md`
   - contract tests
7. Feature internals are private. Cross-feature imports must go through `src/features/<feature>/index.ts` (enforced by `ARC001` policy rule).
8. Features may import only approved core boundary modules (`ARC002`), and state mutation primitives are restricted to approved state boundaries (`ARC003`).
9. New core implementation modules should be added under a bounded subfolder in `src/core/` (for example `session/*`, `state/*`, `shared/*`, `target/*`, `daemon/*`); top-level `src/core/*.ts` files are reserved for stable boundaries/facades.
10. Cross-domain imports inside bounded core folders should go through explicit boundary exports (currently `src/core/session/index.ts` and `src/core/shared/index.ts`) rather than direct internal file coupling (`ARC004`).

## Agent UX baseline

A runtime agent should be able to run exactly this sequence without reading repo internals:

```bash
surfwright --json contract
surfwright --json session ensure
surfwright --json open https://example.com
```

If this loop breaks, the agent surface is regressing.
