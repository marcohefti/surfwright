# Follow-up Round 1 (Direct Answers)

## 1) What else can we improve beyond first pass?

Short answer: yes, five additional maintainability improvements stood out.

1. Harden state read/write failure semantics to prevent silent destructive resets.
Evidence: `src/core/state/infra/state-store.ts:206-208`, `:270-271`, `:309-314`.

2. Unify daemon metadata validation/security into one shared module.
Evidence: duplicated functions in `src/core/daemon/infra/daemon.ts:83`, `:91`, `:103`, `:160` and `src/core/daemon/infra/worker.ts:35`, `:43`, `:55`, `:92`; drift on `startedAt` validation at `daemon.ts:124-126` vs `worker.ts:68-76`.

3. Reduce pipeline alias surface (canonical step IDs only).
Evidence: alias IDs in `src/core/pipeline-support/infra/plan-types.ts:7-14`; alias branching in `src/core/pipeline-support/infra/plan-lint.ts:126`, `:135`, `:193`, `:206`; alias trampolines in `src/core/pipeline/infra/execute-shared.ts:130`, `:289`, `:344`.

4. Split `execute-shared.ts` into step-family executors and isolate repeat-until engine.
Evidence: `src/core/pipeline/infra/execute-shared.ts:63` (single large map), `:131-287` (control-flow engine in same module), file size 451 LOC.

5. Reduce boilerplate in pipeline ops adapter and recover stronger typing.
Evidence: repeated broad casts at `src/core/pipeline/app/run-ops.ts:29`, `:31`, `:52`, `:76`, `:98`, `:122`, `:174`, `:293`, `:337`, `:359`, `:381`, `:401`, `:419`; file size 422 LOC.

## 2) Anything critical we missed?

Yes: one high-priority miss.

- Critical maintainability risk: silent fallback to empty state on read/version errors can become persistent data loss when `updateState` writes afterward.
Evidence: `src/core/state/infra/state-store.ts:206-208`, `:270-271`, `:309-314`.

I did not find a second new P0-level blocker in this round, but this one should be treated as urgent because it affects recovery and operator trust.

## 3) What should be improved now to increase maintainability and scalability as we grow?

Priority order for immediate execution:

1. State persistence hardening first (A2-MAIN-009).
Scope: replace silent-empty fallback with typed state-read failures/quarantine strategy; add corruption + version-mismatch tests.
Evidence anchor: `src/core/state/infra/state-store.ts:206-208`, `:270-271`, `:309-314`.
Expected impact: prevents accidental state obliteration and improves diagnosability.

2. Daemon metadata single-source refactor (A2-MAIN-010).
Scope: shared `daemon-meta` parser/validator/permission check module used by `daemon.ts` and `worker.ts`.
Evidence anchor: `src/core/daemon/infra/daemon.ts:103-139`, `src/core/daemon/infra/worker.ts:55-89`.
Expected impact: eliminates drift in control-plane behavior.

3. Pipeline canonical-ID cleanup (A2-MAIN-011).
Scope: one canonical step ID per command path; normalize at parse boundary; remove alias branches.
Evidence anchor: `src/core/pipeline-support/infra/plan-types.ts:7-14`, `src/core/pipeline-support/infra/plan-lint.ts:126`, `:135`, `:193`.
Expected impact: smaller validator/executor complexity as step surface grows.

4. Break execution monoliths (A2-MAIN-012, A2-MAIN-013).
Scope: split step executors by family and reduce pass-through adapter duplication.
Evidence anchor: `src/core/pipeline/infra/execute-shared.ts:63`, `:131-287`; `src/core/pipeline/app/run-ops.ts:29`, `:174`, `:419`.
Expected impact: faster feature delivery with lower regression blast radius.

## Groundrules Compliance Check

- page-specific optimization avoided: yes
- kind-of-page optimization avoided: yes
- cross-site benefit explained: yes
- evidence cited: yes
