# Policy Harness and Layering

## Problem

SurfWright’s architecture is mostly enforced, not just described. Without enforcement, “core boundaries” and “feature purity” rot fast under pressure, and review turns into archaeology. The policy harness makes architectural rules concrete, fast, and machine-readable.

## Design Goals

- Fast, deterministic checks suitable for agent loops and CI.
- Rules map to real file boundaries (glob-based) with minimal magic.
- Violations are short, typed, and actionable (rule id + file + message).
- Strict mode exists and can ratchet without destabilizing day-to-day work.

## Non-goals

- This is not a full static type/lint system.
- The harness does not attempt deep semantic analysis; it enforces structural constraints.

## Where the Logic Lives

- Human overview: `docs/policy-harness.md`
- Config:
  - `policy/config.json` (baseline)
  - `policy/config.strict.json` (stricter gates for `validate:strict`)
- Runner: `scripts/policy-check.mjs` (`pnpm -s policy:check`, `pnpm -s policy:check:strict`)
- Rule registry + implementations:
  - `policy/rules/index.mjs`
  - `policy/rules/*.mjs`
  - `policy/rules/architecture/*.mjs`
  - `policy/rules/budgets/*.mjs`

## Runtime Flow

1. `scripts/policy-check.mjs` loads the selected config and enumerates repository files.
2. Each enabled rule filters the file list via config `include`/`exclude` globs.
3. Each rule returns an array of violations (or none).
4. Violations are sorted and printed (or emitted as JSON with `--json`).

## Invariants / Guardrails (How to Fix Common ARC*/BUDG* Failures)

This is a navigation layer. For the full list, see `docs/policy-harness.md` and `policy/config.json`.

- `ARC001 feature-boundaries` (feature internals are private)
  - If you imported another feature’s internal module:
    - go through that feature’s `src/features/<feature>/index.ts` facade instead.
  - Where to look:
    - config: `policy/config.json` (`feature-boundaries`)
    - rule: `policy/rules/feature-boundaries.mjs`

- `ARC002 feature-core-imports` (features can only import approved core facades)
  - If a feature needs a new core entrypoint:
    - add it under `src/core/<domain>/public.ts` (or domain `index.ts`) and include it in the allowlist if needed.
  - Where to look:
    - allowlist: `policy/config.json` (`allowCoreImports`)
    - rule: `policy/rules/feature-core-imports.mjs`

- `ARC003 state-boundaries` (state mutations are restricted)
  - If you need to mutate state from outside the state repo layer:
    - push the mutation behind `src/core/state/repo/**` and expose a higher-level function from `src/core/state/public.ts` (for features) or `src/core/state/index.ts` (for core-internal use).
  - Where to look:
    - config: `policy/config.json` (`mutationBindings`, `allowMutationImportFromState`)
    - rule: `policy/rules/state-boundaries.mjs`

- `ARC004 core-boundaries` (bounded core domains import each other via stable entrypoints)
  - If a core domain imported another domain’s internal file:
    - route through `src/core/<domain>/(public|index)` instead.
  - Where to look:
    - bounded domains: `policy/config.json` (`boundedDomains`)
    - rule: `policy/rules/core-boundaries.mjs`

- `ARC007 boundary-json-parse` (JSON.parse is only allowed in explicit boundaries)
  - If you added a `JSON.parse`:
    - either move parsing to an existing boundary module, or add a new boundary and include it in the allowlist.
  - Where to look:
    - allowlist: `policy/config.json` (`boundary-json-parse.allowlist`)
    - rule: `policy/rules/boundary-json-parse.mjs`

- `ARC009 core-root-freeze` (discourages growing `src/core/*.ts`)
  - If you added a new `src/core/<name>.ts` file:
    - prefer `src/core/<domain>/**` instead; core-root is reserved for stable facades.
  - Where to look:
    - allowlist: `policy/config.json` (`core-root-freeze.allowlist`)
    - rule: `policy/rules/core-root-freeze.mjs`

- Budgets (`BUDG*`)
  - If you hit a budget failure, it’s a ratchet:
    - fix the underlying drift rather than bumping the number by default.
  - Where to look:
    - rules: `policy/rules/budgets/*.mjs`
    - config: `policy/config.json`

## Observability

- Human-readable output is stable and low-noise (file + rule id).
- Machine output is available via `node scripts/policy-check.mjs --json`.
- Strict mode is explicitly selected via config:
  - `pnpm -s policy:check:strict` uses `policy/config.strict.json`.

## Testing Expectations

- Policy checks must remain fast (filesystem-based) and deterministic.
- New architectural constraints should be added as policy rules, not as “tribal knowledge” in PR comments.

