# SurfWright Architecture (Map)

This file is the short, high-signal map.
Deep dives live in `docs/architecture.md` to keep the root overview readable and to avoid drift.

Read order:

1. `README.md` (what the product is and how operators use it)
2. `AGENTS.md` (repo workflow + guardrails for builders)
3. `docs/architecture.md` (deep-dive index)
4. `docs/agent-guidance-architecture.md` (compat shim + boundary rules for agents working in-repo)

## Where Truth Lives

- Runtime contract (machine): `surfwright --json contract`
- Contract snapshot gate (CI): `pnpm -s contract:snapshot:check` (`scripts/checks/contract-snapshot.mjs` reads `dist/cli.js --json contract`)
- Architecture enforcement (repo): `pnpm -s policy:check` / `pnpm -s policy:check:strict` (`policy/config.json`, `policy/rules/*`, `scripts/policy-check.mjs`)
- Human docs: `README.md`, `AGENTS.md`, `docs/*`

## One-Screen System Model

- CLI entrypoint/orchestration: `src/cli.ts`
  - global flags (`--json`, `--pretty`, `--agent-id`, `--workspace`, `--session`)
  - dot-command alias rewriting (manifest-driven)
  - daemon proxy default path with explicit bypass for streaming commands and special cases
  - internal workers: `__network-worker`, `__daemon-worker`
- Feature plugins + manifests: `src/features/registry.ts`
  - each feature exposes a command manifest (`src/features/*/manifest.ts`)
  - manifests are aggregated into the contract (`surfwright --json contract`) and drive dot-alias support
- Core domains: `src/core/<domain>/{app,domain,infra}`
  - bounded domains (daemon/session/target/state/etc) with policy-enforced layering
- Explicit, versioned state: `src/core/state/domain/migrations.ts`
  - state is migrated forward on read; upgrades are explicit and versioned

## Deep Dives

Start at `docs/architecture.md`, then:

- `docs/architecture/cli-and-daemon.md`
- `docs/architecture/contract-system.md`
- `docs/architecture/features-and-commands.md`
- `docs/architecture/state-and-migrations.md`
- `docs/architecture/policy-and-layering.md`
