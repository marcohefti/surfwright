# Maintaining Agent Surface

This checklist keeps CLI behavior, runtime skill guidance, and repo docs aligned.
For routing decisions (what to update, where, and why), use `docs/agent-dev-flow.md`.

## 1) When CLI behavior changes

Update these in the same PR:

1. Code in `src/core/*` and/or `src/cli.ts`
2. Contract payload in `src/core/usecases.ts` (`getCliContractReport`)
3. Contract tests in `test/cli.contract.test.mjs`
4. Skill references in `skills/surfwright/references/*` when workflows/errors change

## 2) Validate before merge

Run:

```bash
pnpm validate
pnpm test
pnpm skill:validate
```

## 3) Install/update local skill

```bash
pnpm skill:install
```

By default this installs `skills/surfwright` into `${CODEX_HOME:-~/.codex}/skills/surfwright`.

## 4) Release confidence checks

1. Contract shape check:

```bash
surfwright --json contract
```

2. Core runtime loop:

```bash
surfwright --json session ensure
surfwright --json open https://example.com
```

3. Typed failure check:

```bash
surfwright --json open not-a-url
```

Expect non-zero exit and `{"ok":false,"code":...}` payload.

## 5) Drift policy

- If docs and code disagree, code + contract command win.
- Fix docs/skill in the same change window; do not defer drift cleanup.
