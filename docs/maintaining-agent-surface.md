# Maintaining Agent Surface

This checklist keeps CLI behavior, runtime skill guidance, and repo docs aligned.
For routing decisions (what to update, where, and why), use `docs/agent-dev-flow.md`.

## 1) When CLI behavior changes

Update these in the same PR:

1. Code in `src/core/*` and/or `src/cli.ts`
2. Feature command specs in `src/features/*/commands/*` (single source for CLI + contract)
3. Contract composition in `src/core/cli-contract.ts`
4. Contract tests in `test/contract.commands.test.mjs`
5. Skill references in `skills/surfwright/references/*` when workflows/errors change

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

## 6) Edge-case fixture policy

When real-world behavior reveals a new edge case, add a deterministic ingress fixture and test coverage in the same change window.

- Follow `docs/fixture-ingress-workflow.md`.
- Store normalized SurfWright contract behavior, not raw Playwright/CDP payloads.
- Use the fixture path convention under `test/fixtures/ingress/...`.

## 7) State hygiene policy

When a workstation restarts or browser processes are interrupted, run a maintenance pass before blaming command behavior:

```bash
surfwright --json state reconcile
```

This combines:

- `session prune` (remove unreachable attached sessions; repair stale managed pid metadata)
- `target prune` (remove orphaned/aged target metadata and enforce per-session cap)

For scheduled cleanup, a weekly `state reconcile` is sufficient for most operator workflows.
