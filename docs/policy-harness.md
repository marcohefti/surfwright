# Policy Harness

This repository uses a lightweight, agent-first policy harness for structural checks.

## Why

- Deterministic, concise output for agents.
- Fast execution with minimal dependencies.
- Explicit plug-in model for adding rules.

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

## Exit Codes

- `0`: pass
- `1`: policy violations
- `2`: harness/config/runtime error
