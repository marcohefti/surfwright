# Maintaining Agent Surface

This checklist keeps CLI behavior, runtime skill guidance, and repo docs aligned.
For routing decisions (what to update, where, and why), use `docs/agent-dev-flow.md`.

## 1) When CLI behavior changes

Update these in the same PR:

1. Feature command registration/specs in `src/features/*/register-commands.ts` and `src/features/*/manifest.ts`
2. Runtime behavior in `src/core/*` used by those features
3. Contract composition in `src/core/cli-contract.ts` (manifest aggregation only)
4. Contract tests in `test/commands.contract.test.mjs` and snapshot fixture at `test/fixtures/contract/contract.snapshot.json`
5. Runtime skill bootstrap in `skills/surfwright/SKILL.md` when agent protocol changes

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
- For a fast operator-surface sanity pass across core browser commands, run `pnpm smoke` (deterministic `data:` pages + minimal network probes).
- If `surfwright contract` changes intentionally, update the snapshot with `pnpm contract:snapshot:update` (this also auto-syncs skill `requires.contractFingerprint` in `skills/surfwright/skill.json` and `skills/surfwright.lock.json`).
- `pnpm skill:validate` enforces a concise SurfWright SKILL protocol (contract-first lookup, no broad `--help` discovery drift).

## 3) Install/update local skill

```bash
pnpm skill:install
```

By default this installs `skills/surfwright` into `${CODEX_HOME:-~/.codex}/skills/surfwright`.

## 3b) Dev workstation auto-sync (recommended)

If you are actively developing SurfWright and want your machine to always use the newest local
CLI + skill after `git commit` / `git push`, install the local git hooks:

```bash
pnpm dev:install-git-hooks
```

What it does (best-effort, never blocks git operations):

- builds the local CLI (`pnpm build`)
- shadows the published npm installation for your active Node version via `npm link --force`
- installs the skill into `${CODEX_HOME:-~/.codex}/skills/surfwright`

Undo:

- remove the hooks in `.git/hooks/` (post-commit, pre-push, post-merge, post-checkout, post-rewrite)
- run `npm unlink -g surfwright` to stop shadowing the published install for the current Node version
- reinstall the published CLI if you want it back on `PATH` (example: `npm i -g @marcohefti/surfwright`)

## 4) Release confidence checks

1. Contract shape check:

```bash
surfwright contract
```

2. Core runtime loop:

```bash
surfwright open https://example.com
surfwright target snapshot <targetId>
```

3. Typed failure check:

```bash
surfwright open not-a-url
```

Expect non-zero exit and `{"ok":false,"code":...}` payload.

## 5) Drift policy

- If docs and code disagree, code + contract command win.
- Fix docs/skill in the same change window; do not defer drift cleanup.
- Do not ship deprecated compatibility aliases in output shapes/flags/commands. Remove obsolete surface area outright and update tests/docs/skill references atomically.

## 5b) ZCL efficiency policy

After browser-control campaign runs, enforce token-efficiency budgets before accepting baseline changes:

```bash
pnpm zcl:efficiency:check --run <runDir>
```

Budget source: `test/fixtures/perf/zcl-efficiency-budgets.json`.

## 5c) Benchmark verification loop

For repeated SurfWright-only optimization cycles, use the versioned loop harness:

```bash
pnpm bench:loop:run --mode optimize --label exp-1 --mission-id 018-infinite-scroll-chunks --hypothesis "<why>" --change "<what changed>"
pnpm bench:loop:history --mission-id 018-infinite-scroll-chunks
```

Interpretation rule: "iteration" means optimize iteration by default (`change -> run -> evaluate`). Use `--mode sample` only for explicit no-change variance runs.
Use `agentsPerMission` (config or `--agents-per-mission`) when a scope should run parallel fresh-agent attempts in one campaign run.

Versioned loop assets:

- `bench/agent-loop/config.json`
- `bench/agent-loop/AGENT_LOOP.md`
- `bench/agent-loop/scopes/<scopeId>/history.jsonl`
- `bench/agent-loop/scopes/<scopeId>/RESULT_SHEET.md`

Non-versioned per-iteration artifacts:

- `tmp/zerocontext/bench-loop/<loopId>/<scopeId>/<iterationId>/...`

## 6) Edge-case fixture policy

When real-world behavior reveals a new edge case, add a deterministic ingress fixture and test coverage in the same change window.

- Follow `docs/fixture-ingress-workflow.md`.
- Store normalized SurfWright contract behavior, not raw Playwright/CDP payloads.
- Use the fixture path convention under `test/fixtures/ingress/...`.

## 7) State hygiene policy

When a workstation restarts or browser processes are interrupted, run a maintenance pass before blaming command behavior:

```bash
surfwright state reconcile
```

This combines:

- `session prune` (remove unreachable attached sessions; repair stale managed pid metadata)
- `target prune` (remove orphaned/aged target metadata and enforce per-session cap)

For explicit teardown, use:

```bash
surfwright session clear
```

- default behavior clears sessions/targets and shuts down associated browser processes
- use `--keep-processes` only when you intentionally want state reset without process teardown

For long-lived automation, use per-agent state namespaces with `SURFWRIGHT_AGENT_ID=<agentId>`.

`session ensure` includes an automatic session hygiene pass for shared-session workflows, but a scheduled weekly `state reconcile` is still a good full cleanup baseline.

SurfWright also runs a bounded detached opportunistic maintenance pass on normal command ingress to:

- park long-idle managed browser processes
- prune stale disk artifacts (`runs/`, `captures/`, orphan `profiles/` dirs) with conservative caps

Use `state disk-prune` for explicit deterministic disk cleanup (supports `--dry-run` and optional workspace profile pruning).
`state reconcile` remains the state-shape/session/target maintenance command.
