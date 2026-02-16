# Policy Harness

This repository uses a lightweight, agent-first policy harness for structural checks.

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
  id: "LOC001",
  name: "max-loc",
  description: "File must not exceed a configured line count limit",
  defaultOptions: { ... },
  check: async ({ files, options, helpers }) => Violation[],
};
```

`Violation` shape:

```js
{
  ruleId: "LOC001",
  ruleName: "max-loc",
  severity: "error",
  file: "src/cli.ts",
  message: "612 > 500 (+112)",
  actual: 612,
  limit: 500,
  overBy: 112,
  suggestion: "Split file by concern to reduce file size and review scope"
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
- `ARC005 surface-command-purity`: surface command modules must not contain hidden behavior (keep pure wiring).
- `ARC006 domain-no-cross-domain`: domain layers must not cross-import other domains.
- `ARC007 boundary-json-parse`: `JSON.parse` is allowed only in explicit boundary modules.
- `ARC008 core-layer-purity`: app/domain layers must not import from infra/boundary modules.
- `ARC009 core-root-freeze`: adding new `src/core/*.ts` modules requires an explicit decision (freeze core-root growth).
- `ARC010 feature-layer-purity`: feature `domain/**` and `usecases/**` must not import Node built-ins or Playwright (keeps feature layers pure and testable).
- `ARC011 core-root-state-imports`: code outside the state domain must not import a core-root state facade (use `src/core/state/index` for core internals and `src/core/state/public` for feature access).
- `DIR001 max-files-per-directory`: keeps directories small for review and navigation.
- `LOC001 max-loc`: prevents single-file mega-modules.

## Exit Codes

- `0`: pass
- `1`: policy violations
- `2`: harness/config/runtime error
