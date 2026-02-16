# Maintaining Agent Surface

This checklist keeps CLI behavior, runtime skill guidance, and repo docs aligned.
For routing decisions (what to update, where, and why), use `docs/agent-dev-flow.md`.

## 1) When CLI behavior changes

Update these in the same PR:

1. Feature command registration/specs in `src/features/*/register-commands.ts` and `src/features/*/manifest.ts`
2. Runtime behavior in `src/core/*` used by those features
3. Contract composition in `src/core/cli-contract.ts` (manifest aggregation only)
4. Contract tests in `test/commands.contract.test.mjs` and snapshot fixture at `test/fixtures/contract/contract.snapshot.json`
5. Skill references in `skills/surfwright/references/*` when workflows/errors change

## 2) Validate before merge

Run:

```bash
pnpm validate
pnpm test
pnpm skill:validate
pnpm contract:snapshot:check
```

Notes:

- `pnpm validate` is the main gate. It runs policy, docs, perf budgets, contract snapshot checks, and knowledge-store drift checks.
- Browser-dependent contract tests live under `test/browser/` and are not part of `pnpm test`. Run `pnpm test:browser` locally when changing browser-executing commands.
- If `surfwright --json contract` changes intentionally, update the snapshot (`pnpm contract:snapshot:update`) and keep skill pins aligned (`skills/surfwright/skill.json` and `skills/surfwright.lock.json`).

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
surfwright --json open https://example.com
surfwright --json target snapshot <targetId>
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

For explicit teardown, use:

```bash
surfwright --json session clear
```

- default behavior clears sessions/targets and shuts down associated browser processes
- use `--keep-processes` only when you intentionally want state reset without process teardown

For long-lived automation, use per-agent state namespaces with `SURFWRIGHT_AGENT_ID=<agentId>`.

`session ensure` includes an automatic session hygiene pass for shared-session workflows, but a scheduled weekly `state reconcile` is still a good full cleanup baseline.
