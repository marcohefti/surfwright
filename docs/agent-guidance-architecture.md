# Agent Guidance Architecture

This repository serves two distinct consumers:

1. Development agents/operators working inside the repo.
2. Runtime agents driving the shipped `surfwright` CLI.

To keep both fast and maintainable, we separate guidance into explicit layers with one source of truth per layer.

## Source-of-truth map

- Runtime contract (machine): `surfwright --json contract`
- Runtime behavior (verification): `test/cli.contract.test.mjs`
- Product/developer narrative (human): `README.md`, `AGENTS.md`, `docs/*.md`
- Installed skill for active usage: `skills/surfwright/`

## Storage model

- `src/`: executable behavior only.
- `docs/`: maintainer-facing architecture and update procedures.
- `skills/surfwright/`: Codex skill package for runtime invocation.
- `scripts/`: install/validate automation for skills.

## Design rules

1. Do not duplicate command contracts in multiple files. Use `surfwright --json contract` as canonical machine reference.
2. Keep `skills/surfwright/SKILL.md` concise and procedural; push detail to `skills/surfwright/references/*`.
3. Keep docs for humans in `docs/`; avoid auxiliary docs inside skill directories.
4. Any new/changed error code must be reflected in:
   - `src/core/usecases.ts` contract payload
   - `skills/surfwright/references/error-handling.md`
   - contract tests

## Agent UX baseline

A runtime agent should be able to run exactly this sequence without reading repo internals:

```bash
surfwright --json contract
surfwright --json session ensure
surfwright --json open https://example.com
```

If this loop breaks, the agent surface is regressing.
