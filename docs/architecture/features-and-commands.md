# Features, Plugins, and Command Registration

## Problem

SurfWright needs a growing command surface without turning the CLI into a monolith. We want a plugin-like structure without a runtime plugin system: features should register commands in a consistent way, and the contract should be derived from the same inputs.

## Design Goals

- Keep `src/cli.ts` orchestration-only (global flags, daemon routing, feature registration).
- Feature modules own their command wiring and behavior boundaries.
- Command manifests are the contract inputs and stay close to feature implementations.
- Split stable vs experimental features explicitly.

## Non-goals

- No dynamic plugin loading at runtime.
- No cross-feature “internal” imports (policy-enforced).

## Where the Logic Lives

- Feature plugin registry:
  - `src/features/registry.ts`
    - `stableFeaturePlugins` / `experimentalFeaturePlugins`
    - `allCommandManifest` (flattened contract inputs)
    - `registerFeaturePlugins(ctx)` (Commander registration)
- Feature manifests:
  - `src/features/*/manifest.ts` (examples: `runtime`, `target-core`, `network`, `extensions`)
- Feature command wiring:
  - `src/features/*/register-commands.ts`
    - pattern: build a feature context, then loop `commandSpecs` and call `spec.register(ctx)`
    - example: `src/features/network/register-commands.ts`
- CLI dot-alias support (manifest-driven):
  - `src/cli.ts` builds `DOT_COMMAND_ALIAS_MAP` from `allCommandManifest`

## Runtime Flow

1. CLI creates a Commander program:
   - global flags are declared in `src/cli.ts`.
2. CLI registers features:
   - `registerFeaturePlugins(...)` iterates feature plugins and invokes each plugin’s `register(ctx)`.
3. Feature registers commands:
   - Feature `register-commands.ts` loops command specs and wires subcommands under the appropriate Commander root (for example `target`, `session`, `extension`).
4. Manifest drives contract and aliases:
   - Contract output uses the manifests as the authoritative list (`src/features/registry.ts` -> `src/core/cli-contract.ts`).
   - Dot aliases like `target.snapshot` work because `src/cli.ts` rewrites based on manifest `id`.

## Invariants / Guardrails

- Manifests are authoritative:
  - if a command exists in Commander, it must exist in the manifest and therefore in `--json contract` (truth-pinned by `test/dot-alias.contract.test.mjs`).
- Feature stability is explicit:
  - experimental features live in `experimentalFeaturePlugins` and are aggregated into the contract separately in fixtures (`test/fixtures/contract/commands.experimental.json` is checked by `test/commands.contract.test.mjs`).
- Features are isolated:
  - cross-feature internal imports are blocked by policy (`ARC001`).
- Feature purity is enforced:
  - “surface command wiring” must stay thin (`ARC005` / `surface-command-purity` in `policy/config.json`).
  - feature `domain/**` and `usecases/**` must avoid Node/Playwright imports (`ARC010` / `feature-layer-purity`).

## Observability

- `surfwright --json contract` is the canonical machine-readable view of the command surface.
- Contract fixtures and truth tests provide quick signal when registration/manifests drift.

## Testing Expectations

- Contract fixtures cover stable vs experimental surfaces (`test/commands.contract.test.mjs`).
- Help traversal vs contract ids stays consistent (`test/dot-alias.contract.test.mjs`).

