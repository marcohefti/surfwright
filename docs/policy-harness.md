# Policy Harness

This repository uses a lightweight, agent-first policy harness for structural checks.
Language linting is handled separately by `oxlint` (`pnpm lint`).

## Why

- Deterministic, concise output for agents.
- Fast execution with minimal dependencies.
- Explicit plug-in model for adding rules.
- Strict by default (no warn-mode): new boundary claims must be enforceable.

## Layout

- Config: `policy/config.json`
- Rule registry: `policy/rules/index.mjs`
- Rule implementations: `policy/rules/*.mjs`
- Runner: `scripts/policy-check.mjs`

## Rule Interface

Each rule exports a `rule` object:

```js
export const rule = {
  id: "ARC001",
  name: "feature-boundaries",
  description: "Cross-feature imports must go through feature public index",
  defaultOptions: { ... },
  check: async ({ files, options, helpers }) => Violation[],
};
```

`Violation` shape:

```js
{
  ruleId: "ARC001",
  ruleName: "feature-boundaries",
  severity: "error",
  file: "src/features/runtime/commands/runtime.run.ts",
  message: "cross-feature import must target src/features/<name>/index",
  suggestion: "Import via the other feature public index"
}
```

## Adding a Rule

1. Add `policy/rules/<rule-name>.mjs` exporting `rule`.
2. Register it in `policy/rules/index.mjs`.
3. Enable/configure it in `policy/config.json`.
4. Run:

```bash
pnpm policy:check
```

## Running

Human-readable:

```bash
pnpm policy:check
```

Code lint:

```bash
pnpm lint
```

Machine-readable:

```bash
node scripts/policy-check.mjs --json
```

## Active Rules (Overview)

Policy rules are intentionally simple and file-system based. The names below map to `policy/config.json`.

- `ARC001 feature-boundaries`: features must not reach into other feature internals.
- `ARC002 feature-core-imports`: features may import core only via approved facades (typically `src/core/*/public`).
- `ARC003 state-boundaries`: state mutation primitives are imported only by `src/core/state/repo/**`.
- `ARC004 core-boundaries`: bounded core domains import each other only via `src/core/<domain>/(public|index)`.
- `ARC006 domain-no-cross-domain`: domain layers must not cross-import other domains.
- `ARC007 boundary-json-parse`: `JSON.parse` is allowed only in explicit boundary modules.
- `ARC009 core-root-freeze`: adding new `src/core/*.ts` modules requires an explicit decision (freeze core-root growth).
- `ARC011 core-root-state-imports`: code outside the state domain must not import a core-root state facade (use `src/core/state/index` for core internals and `src/core/state/public` for feature access).
- `ARC012 core-domain-root-freeze`: bounded core domain roots only keep stable entrypoints (`index.ts`, `public.ts`).
- `ARC013 core-layer-direction`: core layer imports follow direction; `app`/`domain` must not depend on `infra`.
- `ARC014 feature-layer-direction`: feature flow is `commands -> usecases -> domain`; reverse/sideways imports are blocked.
- `ARC015 public-surface-curation`: `src/core/**/public.ts` should avoid direct `infra/**` coupling unless explicitly allowlisted.
- `BUDG001 core-layer-structure-budget`: budget for how many bounded core domains are still missing `app/domain/infra` structure (ratchet to 0).
- `DIR001 max-files-per-directory`: keeps directories small for review and navigation.

`oxlint` now enforces language-level constraints previously handled by policy scripts:

- `no-explicit-any`
- `max-lines` (500) for `src/**/*.ts`, `scripts/**/*.mjs`, `test/**/*.mjs`
- `no-restricted-imports` constraints for feature/core layer purity and node import boundaries
- `node/no-process-env` constraints for env-access boundaries

## Exit Codes

- `0`: pass
- `1`: policy violations
- `2`: harness/config/runtime error
