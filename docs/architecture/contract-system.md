# Contract System (Manifest-Driven)

## Problem

Agents and automation depend on a stable command surface. If CLI help, registration, and “contract” output drift, agents break in ways that are hard to diagnose. We need one source of truth for command ids/usage/summary, plus a hard gate that prevents accidental contract drift.

## Design Goals

- Single source of truth for command metadata:
  - command `id`
  - `usage` string (operator/agent copy-paste target)
  - `summary` (help text / discoverability)
- Deterministic contract output:
  - stable JSON shape
  - stable ordering where relevant
- CI gate that fails on drift (snapshot-based).
- Keep contract generation independent from Commander help formatting quirks.

## Non-goals

- The contract is not generated from parsing `--help` output.
- The contract is not a semantic versioning system. It’s a fingerprinted snapshot of surfaced ids and error codes.

## Agent Discovery Policy

- Agent discovery is contract-first:
  - `surfwright contract` returns a minimal bootstrap envelope for low-token loops.
  - `surfwright contract --full` returns full command/error id catalogs.
  - `surfwright contract --command <id>` and `--commands <id1,id2>` are the detailed lookup paths.
- `--help` is intentionally disabled; runtime agents must use contract lookup only.
- Contract responses must stay compact enough for repeated agent loops.

## Where the Logic Lives

- Command manifests (the contract inputs):
  - `src/features/*/manifest.ts`
    - examples: `src/features/runtime/manifest.ts`, `src/features/target-core/manifest.ts`, `src/features/network/manifest.ts`, `src/features/extensions/manifest.ts`
- Feature registry (aggregation):
  - `src/features/registry.ts`
    - `allCommandManifest`: flattened list of all feature command manifests
    - `registerFeaturePlugins`: registers Commander commands for each feature
- Contract report + fingerprint:
  - `src/core/cli-contract.ts`
    - `computeContractFingerprint()`: SHA-256 over normalized command ids/usage/summary + error codes
    - `getCliContractReport(version)`: the payload behind `surfwright contract`
- Snapshot gate (CI / validation):
  - `scripts/checks/contract-snapshot.mjs`
    - executes `dist/cli.js contract --full` (explicit, though JSON is the default)
    - normalizes/sorts and compares against `test/fixtures/contract/contract.snapshot.json`
- Contract truth tests:
  - `test/commands.contract.test.mjs` (fixtures for expected ids and usage fragments)
  - `test/dot-alias.contract.test.mjs` (contract ids must match Commander-registered leaves)
  - `test/daemon.contract.test.mjs` (daemon path must preserve contract determinism)

## Runtime Flow

1. Define/modify commands in a feature:
   - Add a manifest entry in `src/features/<feature>/manifest.ts`.
   - Register the actual Commander command in `src/features/<feature>/register-commands.ts` (via command specs).
2. Aggregate contract:
   - `src/features/registry.ts` flattens all manifests into `allCommandManifest`.
   - `src/core/cli-contract.ts` builds the contract report and fingerprint using `allCommandManifest`.
3. Emit contract:
   - `surfwright contract` returns a compact bootstrap from `getCliContractReport(...)`.
   - `surfwright contract --full` returns the full machine catalog.
4. Enforce in CI:
   - `pnpm -s build` produces `dist/cli.js`.
   - `pnpm -s contract:snapshot:check` runs `scripts/checks/contract-snapshot.mjs --check`.

## Invariants / Guardrails

- Manifest-driven means manifests must match reality:
  - `id` must correspond to the leaf command path Commander registers (truth-pinned by `test/dot-alias.contract.test.mjs`).
  - `usage` strings are linted by fixture-based expectations (partial match) in `test/commands.contract.test.mjs`.
- Fingerprint stability:
  - `contractFingerprint` is derived from `{ id, usage, summary }` for commands and `{ code, retryable }` for errors (`src/core/cli-contract.ts`).
  - If you change any of those fields (or add/remove commands/errors), the snapshot and/or fixtures must be updated intentionally.
- Snapshot is dist-backed:
- The snapshot script reads the built CLI (`dist/cli.js`) to avoid “ts-node vs dist” drift (`scripts/checks/contract-snapshot.mjs`).

## Observability

- Contract output includes:
  - `contractSchemaVersion`
  - `contractFingerprint`
  - `commands[]` and `errors[]` (via `surfwright contract --full`)
- Snapshot check produces a short diff summary (counts) and a single remediation command (`scripts/checks/contract-snapshot.mjs`).

## Testing Expectations

- Contract payload matches expected command surface fixture sets (`test/commands.contract.test.mjs`).
- Contract ids match Commander help-derived leaf ids (truthfulness) (`test/dot-alias.contract.test.mjs`).
- Daemon path does not change contract output determinism (`test/daemon.contract.test.mjs`).
