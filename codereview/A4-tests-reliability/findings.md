# A4 Tests & Reliability Review

## Scope and method
- Reviewed test strategy, fixture discipline, contract test quality, and regression protection boundaries across `test/`, `docs/`, `package.json`, and CI workflows.
- Executed runtime lanes for evidence:
  - `pnpm -s test:fixtures` -> pass (1/1)
  - `pnpm -s test:contract` -> pass (178/178)

## Findings (ordered by severity)

### A4-TR-001 (High) - Ingress fixture lane validates fixture JSON, not runtime behavior
- Problem: fixture replay currently validates schema and stored `observed`/`expect` values from JSON files, but does not execute commands against runtime. This weakens regression protection for command behavior changes.
- Evidence:
  - `test/ingress.fixture-replay.test.mjs:32-35` reads fixture JSON.
  - `test/ingress.fixture-replay.test.mjs:56-190` validates static `observed` fields per command-specific assertion functions.
  - `test/ingress.fixture-replay.test.mjs:211-263` runs only file validation and dispatch-by-`command.id`; no CLI invocation exists.
  - `docs/fixture-ingress-workflow.md:76` requires adding/extending an integration test that replays the fixture.
- Risk if ignored: behavior can drift while fixture lane stays green; edge-case fixes may regress silently.
- Recommendation: add a runtime replay harness for ingress cases (command-specific adapters) so fixture inputs are executed and compared to expected normalized outputs.

### A4-TR-002 (High) - Browser test masks flaky/runtime regressions by retrying broad error classes
- Problem: `target.effects` browser tests auto-retry `open` when failures include broad codes like `E_INTERNAL` and `E_WAIT_TIMEOUT`, which can hide regressions and convert failing runs into green runs.
- Evidence:
  - `test/browser/target/effects/target.effects.browser.mjs:42-48` includes `E_INTERNAL` and `E_WAIT_TIMEOUT` in retryable set.
  - `test/browser/target/effects/target.effects.browser.mjs:53-59` retries once on those codes.
  - `test/browser/target/effects/target.effects.browser.mjs:57` explicitly documents retry for flaky infra startup races.
- Risk if ignored: nondeterministic bugs become harder to detect; CI signal quality decreases.
- Recommendation: remove broad retry from contract tests; if retry is necessary, gate it behind explicit diagnostic mode and fail with first-attempt payload recorded.

### A4-TR-003 (Medium) - Release draft verification path does not execute browser lane
- Problem: release draft workflow verifies with `pnpm test`, but `pnpm test` excludes `test:browser`.
- Evidence:
  - `package.json:47` defines `test` without `test:browser`.
  - `package.json:42` shows `test:browser` exists as a separate lane.
  - `.github/workflows/release-draft.yml:50-52` runs `pnpm validate`, `pnpm test`, `pnpm skill:validate` only.
  - `.github/workflows/ci.yml:186-189` shows main CI `test` job does run `test:browser` explicitly.
- Risk if ignored: release-draft validations can pass without browser execution checks.
- Recommendation: in release draft workflow, run `pnpm -s test:browser` explicitly (or redefine `pnpm test` to include browser lane and provide a lighter local script separately).

### A4-TR-004 (Medium) - Skip-marker policy does not guard browser tests
- Problem: the no-skip contract policy intentionally excludes `test/browser`, so browser tests can be skipped without policy failure.
- Evidence:
  - `test/policy/no-skips.contract.test.mjs:12-14` excludes directory `browser` from scan.
  - `test/policy/no-skips.contract.test.mjs:21-27` only targets `.contract.test.mjs` files.
  - `test/policy/no-skips.contract.test.mjs:32` policy intent references contract tests only.
- Risk if ignored: browser-lane coverage can erode silently via `test.skip`/`describe.skip` in browser tests.
- Recommendation: add a second policy test for `test/browser/**/*.browser.mjs` skip/todo markers.

### A4-TR-005 (Medium) - Command surface contract test is presence/usage-only, leaving behavior gaps
- Problem: core command-surface contract test checks only `id` presence and `usage.includes(...)`, not command behavior/flag semantics for the full surface.
- Evidence:
  - `test/commands.contract.test.mjs:55-59` validates only existence and usage substring.
  - Commands listed in fixtures include many IDs (`test/fixtures/contract/commands.core.json:4-7,30,44-46,48,50-51,59-60`; `test/fixtures/contract/commands.network.json:7,9,12,14`; `test/fixtures/contract/commands.experimental.json:2`).
  - Coverage probe (`node` scan across `test/**/*.mjs`) found no explicit invocation coverage for these IDs: `workspace.info`, `workspace.init`, `workspace.profile-lock-clear`, `target.read`, `target.console-tail`, `target.health`, `target.hud`, `extension.load`, `extension.reload`, `extension.uninstall`, `skill.doctor`, `skill.update`, `target.network-export-prune`, `target.network-begin`, `target.trace.export`, `target.network-check`, `exp.effects`.
- Risk if ignored: command contract can appear healthy while untested command behavior regresses.
- Recommendation: generate a command smoke matrix from contract fixtures and execute at least one typed success/failure assertion per command id.

### A4-TR-006 (Medium) - Many contract tests run CLI subprocesses without local timeout guards
- Problem: multiple contract files call `spawnSync` without a `timeout`, so stuck subprocesses rely on outer job timeout.
- Evidence:
  - `test/cli.contract.test.mjs:10-17` `spawnSync` without `timeout`.
  - `test/commands.contract.test.mjs:10-17` same pattern.
  - `test/pipeline.contract.test.mjs:10-17,20-28` same pattern.
  - `test/contract/session.clear.contract.test.mjs:11-18` same pattern.
  - Browser helper already has timeout discipline: `test/browser/helpers/cli-runner.mjs:4-6,69-83`.
- Risk if ignored: rare hangs inflate feedback loops and consume CI minutes.
- Recommendation: introduce a shared contract-test CLI runner (parallel to browser helper) with bounded timeout + kill semantics.

### A4-TR-007 (Low) - Fixture workflow doc example omits `observed`, but tests require it
- Problem: doc’s fixture shape example shows `expect` but not `observed`, while fixture replay test enforces `observed` object.
- Evidence:
  - `docs/fixture-ingress-workflow.md:41-67` sample JSON omits `observed`.
  - `test/ingress.fixture-replay.test.mjs:52` requires `fixture.observed` object.
- Risk if ignored: contributor confusion and avoidable fixture PR churn.
- Recommendation: align docs with enforced schema (`observed` required), or relax test if `observed` is intentionally optional.

## Targeted test refactor proposals
1. Build `test/helpers/cli-contract-runner.mjs` and migrate all non-browser contract tests to it (timeout, SIGTERM/SIGKILL, standardized stdout/stderr capture).
2. Add `test/ingress.fixture-runtime-replay.contract.test.mjs`: execute fixture command inputs for deterministic cases and assert normalized outputs against `expect`.
3. Add `test/policy/no-skips.browser.contract.test.mjs` to fail on `test.skip/describe.skip/it.skip` inside `test/browser/**`.
4. Add generated command smoke test (`test/contract/command-smoke-matrix.contract.test.mjs`) derived from `test/fixtures/contract/commands*.json` with per-command minimal assertions.
5. Remove ad-hoc retry from `test/browser/target/effects/target.effects.browser.mjs`; replace with explicit diagnostic rerun mode that still reports first-attempt failure.
6. Update release-draft workflow to run browser lane explicitly, matching CI `test` job guarantees.

## Follow-up Round 1 - Additional Findings

### A4-TR-008 (Medium) - Test lanes are globally serialized, limiting scaling as suite grows
- Problem: both contract and browser lanes force single-concurrency execution.
- Evidence:
  - `package.json:41` uses `node --test ... --test-concurrency=1` for `test:contract`.
  - `scripts/tests/run-browser-tests.mjs:101-104` also sets `--test-concurrency=1` for browser tests.
- Risk if ignored: CI duration and local feedback time will scale linearly with test growth; adding coverage increases cycle time disproportionately.
- Recommendation: introduce safe parallelism by sharding per subsystem and enforcing per-test state isolation first, then raise concurrency incrementally.

### A4-TR-009 (Medium) - Browser tests share mutable state per file, creating order-coupling risk
- Problem: browser test files reuse one `TEST_STATE_DIR` across all tests and clean it only at file end.
- Evidence:
  - `test/browser/core/cli.browser.mjs:9-10` defines single shared state dir/runner; `:42-44` cleans only in `test.after`.
  - `test/browser/core/cli.browser.mjs:49-75` mutates shared `state.json` directly within a test.
  - `test/browser/core/commands.browser.mjs:9-13` follows same shared-state pattern.
- Risk if ignored: hidden inter-test dependencies and fragile ordering; parallelization attempts will fail or become flaky.
- Recommendation: move to per-test state roots (`beforeEach`/`afterEach`) or snapshot-reset helper to isolate mutation boundaries.

### A4-TR-010 (Medium) - Ingress replay harness is a monolithic dispatch chain that does not scale cleanly
- Problem: every new fixture command requires editing a central `if`/`continue` chain.
- Evidence:
  - `test/ingress.fixture-replay.test.mjs:223-259` command dispatch is hard-coded via repeated branches and a default fail path.
- Risk if ignored: rising merge conflicts and contributor friction as ingress command coverage expands.
- Recommendation: replace dispatch chain with a handler registry map (`command.id -> validator`) loaded from modular validator files.

### A4-TR-011 (Low) - Fixture payloads retain volatile observed fields despite workflow guidance
- Problem: fixtures include volatile `observed` values (IDs and timing envelopes) even though workflow says to remove volatile details.
- Evidence:
  - Workflow guidance says remove volatile details: `docs/fixture-ingress-workflow.md:74`.
  - Example volatile fields in fixtures:
    - `test/fixtures/ingress/target.click/basic-selector-click.json:12,21-23,39-44` (`targetId`, `actionId`, timing ms)
    - `test/fixtures/ingress/target.list/duplicate-url-different-targets.json:20-33` (ephemeral target IDs)
- Risk if ignored: fixture maintenance noise and accidental coupling if future replay compares full `observed` payloads.
- Recommendation: add fixture normalization/redaction step to keep only invariant `observed` fields needed by assertions.

### A4-TR-012 (Low) - CI test artifacts under-capture lane diagnostics
- Problem: CI uploads only a minimal `test.log` containing a final echo line, not per-lane output artifacts.
- Evidence:
  - `.github/workflows/ci.yml:186-189` runs three test lanes, then only echoes one summary line to `artifacts/test/test.log`.
  - `.github/workflows/ci.yml:191-196` uploads only that log path.
- Risk if ignored: slower post-failure triage and weaker historical diagnosis from artifacts.
- Recommendation: tee each lane to dedicated artifact logs (`contract.log`, `fixtures.log`, `browser.log`) and upload all.

### A4-TR-013 (Medium) - No explicit coverage instrumentation or threshold gate in test/CI flow
- Problem: current scripts and CI define test execution but no explicit code coverage collection/report/threshold gate.
- Evidence:
  - `package.json:11-51` script set contains no coverage script/command.
  - `.github/workflows/ci.yml:182-189` runs test lanes directly without coverage collection step.
- Risk if ignored: coverage gaps can accumulate without objective visibility, especially on newly added commands.
- Recommendation: add coverage collection (Node test coverage/c8), publish LCOV artifact, and enforce minimum thresholds on changed files.
