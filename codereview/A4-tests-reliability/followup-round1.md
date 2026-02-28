# Follow-up Round 1

## 1) What else can we improve?
- Add runtime-backed ingress replay to execute fixture command inputs, not just JSON schema/value checks.
  - Evidence: `test/ingress.fixture-replay.test.mjs:32-35,56-190,211-263`.
- Expand no-skip policy to browser lane.
  - Evidence: browser dir is excluded from no-skip scan in `test/policy/no-skips.contract.test.mjs:12-14`.
- Improve command behavior coverage with generated smoke matrix from contract command fixtures.
  - Evidence: `test/commands.contract.test.mjs:55-59` checks only id presence + usage substring.
- Add explicit coverage instrumentation and thresholds.
  - Evidence: no coverage script in `package.json:11-51`; CI test job has no coverage step (`.github/workflows/ci.yml:182-189`).
- Increase CI diagnostic depth by uploading per-lane logs.
  - Evidence: single summary log artifact only (`.github/workflows/ci.yml:189,191-196`).

## 2) Any critical reliability/testing risks?
Yes, two remain critical/high-impact:

1. Ingress replay is non-executable (schema-only replay).
- Why critical: this lane can stay green while runtime behavior regresses.
- Evidence: `test/ingress.fixture-replay.test.mjs:211-263` does file/fixture assertions only.

2. Browser effects tests mask failures with retry on broad error classes.
- Why critical: first-attempt instability can be hidden.
- Evidence: retry set includes `E_INTERNAL` and `E_WAIT_TIMEOUT` (`test/browser/target/effects/target.effects.browser.mjs:42-48`) and auto-retry logic executes (`:53-59`).

## 3) What should we improve now for maintainability + scalability moving forward?
Prioritized now (next change window):

1. Isolate state per browser test and prepare concurrency ramp.
- Evidence: file-global shared state dirs + end-of-file cleanup (`test/browser/core/cli.browser.mjs:9-10,42-44`; `test/browser/core/commands.browser.mjs:9-13`).
- Evidence: both lanes currently pinned to single concurrency (`package.json:41`; `scripts/tests/run-browser-tests.mjs:101-104`).

2. Refactor ingress replay harness into modular validator registry + runtime replay lane.
- Evidence: monolithic command-id chain in `test/ingress.fixture-replay.test.mjs:223-259`.

3. Close release/test path mismatch and unify gate semantics.
- Evidence: release-draft uses `pnpm test` only (`.github/workflows/release-draft.yml:50-52`) while `pnpm test` excludes browser lane (`package.json:47`).

4. Add coverage governance and minimal test telemetry artifacts.
- Evidence: no coverage gate scripts (`package.json:11-51`), and CI uploads only summary test log (`.github/workflows/ci.yml:189,191-196`).

## Suggested immediate execution order
1. Remove browser retry masking (`A4-TR-002`) and add browser no-skip policy (`A4-TR-004`).
2. Implement runtime ingress replay (`A4-TR-001`) and modular ingress validator registry (`A4-TR-010`).
3. Introduce shared contract CLI runner timeout guard (`A4-TR-006`) + per-test browser state isolation (`A4-TR-009`).
4. Update release draft + CI artifacts + coverage gate (`A4-TR-003`, `A4-TR-012`, `A4-TR-013`).
