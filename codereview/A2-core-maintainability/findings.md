# Worker A2: Core Maintainability Findings

Scope reviewed: `src/core/**` plus runtime command wiring in `src/features/runtime/register-commands.ts`.

## High

### A2-MAIN-001 - `target-extract-frame.ts` has a single oversized evaluator with high branching complexity
- Category: complexity, oversized-file, readability-debt
- Evidence:
  - `src/core/target/infra/query/target-extract-frame.ts:52` starts one large in-page evaluator callback.
  - Kind-specific branches are all in that one callback (`:123`, `:159`, `:194`, `:231`, `:267`, `:314`, `:392`).
  - File size is `498` LOC (`wc -l`).
- Problem:
  - One function combines extraction logic for many modes (`headings`, `links`, `codeblocks`, `forms`, `tables`, `docs-commands`, `command-lines`, generic fallback), making behavior changes risky and review-heavy.
- Refactor slice:
  - Extract per-kind evaluators into separate ops modules (`extract-kind-headings-op.ts`, `extract-kind-links-op.ts`, etc.).
  - Keep `extractFrameItems` as a dispatcher map `{kind -> evaluator}` + normalization only.
- Expected impact:
  - Smaller diff surfaces per behavior change.
  - Lower branch density per file, simpler targeted tests, faster reviews.
- Risk if ignored:
  - Future changes to one kind can accidentally regress others due to shared monolithic logic.

### A2-MAIN-002 - Repeated DOM helper logic across target query/extract/find paths
- Category: duplication, readability-debt
- Evidence:
  - `selectorHintFor` duplicated in:
    - `src/core/target/infra/query/target-extract-frame.ts:69`
    - `src/core/target/infra/query/target-attr.ts:186`
    - `src/core/target/infra/query/target-extract-table-rows-op.ts:42`
    - `src/core/target/infra/target-find.ts:238`
  - `isVisible` duplicated in:
    - `src/core/target/infra/query/target-extract-frame.ts:56`
    - `src/core/target/infra/query/target-attr.ts:202`
    - `src/core/target/infra/query/target-count.ts:81`
    - `src/core/target/infra/query/target-extract-table-rows-op.ts:29`
    - `src/core/target/infra/target-find.ts:254`
  - Same long interactive candidate selector repeated in:
    - `src/core/target/infra/query/target-attr.ts:265`
    - `src/core/target/infra/query/target-count.ts:119`
    - `src/core/target/infra/target-find.ts:310`
- Problem:
  - Behavior can drift silently when one copy is updated and others are not.
- Refactor slice:
  - Create one shared in-page helper module for DOM ops (visibility, selector-hint, text extraction, interactive selector constant).
  - Reuse it from all evaluator callbacks.
- Expected impact:
  - Single-point behavior changes; fewer inconsistent query semantics.
- Risk if ignored:
  - Inconsistent operator results across `target find/count/attr/extract` for the same page state.

### A2-MAIN-003 - Target command execution lifecycle boilerplate is repeated in multiple files
- Category: duplication, coupling
- Evidence:
  - Repeated timing/session/connect/finalize shape appears in:
    - `src/core/target/infra/target-read.ts:292`, `:305`, `:309`, `:404`, `:409`
    - `src/core/target/infra/target-find.ts:149`, `:168`, `:172`, `:436`, `:441`
    - `src/core/target/infra/target-extract.ts:197`, `:227`, `:231`, `:440`, `:444`
    - `src/core/target/infra/target-eval.ts:140`, `:164`, `:168`, `:433`, `:438`
  - Snapshot persistence is also repeated across many target actions (for example `target-read.ts:394`, `target-find.ts:426`, `target-extract.ts:430`, `target-eval.ts:420`).
- Problem:
  - Cross-cutting behavior (timing fields, persistence policy, close semantics) is implemented repeatedly, increasing drift risk.
- Refactor slice:
  - Introduce a shared `withTargetSessionAction(...)` helper that handles resolve/connect/timing/finally-close and optional snapshot persistence hooks.
- Expected impact:
  - Standardized reports and reduced per-command boilerplate.
- Risk if ignored:
  - Subtle inconsistencies in timing/report fields and future maintenance overhead.

## Medium

### A2-MAIN-004 - `target-read.ts` mixes two command concerns (`target read` and `target form-fill`)
- Category: cohesion, oversized-file
- Evidence:
  - `targetRead` starts at `src/core/target/infra/target-read.ts:281`.
  - `targetFormFill` starts at `src/core/target/infra/target-read.ts:413`.
  - Form-fill parsing/apply helpers occupy `:53-248` in the same file.
  - File size is `499` LOC (`wc -l`).
- Problem:
  - Read extraction and form mutation logic co-evolve in one file despite different responsibilities and failure modes.
- Refactor slice:
  - Split into `target-read.ts` and `target-form-fill.ts` plus shared parser helpers module.
- Expected impact:
  - Better cohesion and easier onboarding for contributors working on one command family.
- Risk if ignored:
  - Changes for one command can unintentionally impact the other.

### A2-MAIN-005 - `target-eval.ts` mixes `target eval`, `target close`, and shared JSON parser utility
- Category: cohesion, coupling
- Evidence:
  - Generic parser utility exported at `src/core/target/infra/target-eval.ts:37`.
  - That parser is imported by extract flow at `src/core/target/infra/target-extract.ts:11`.
  - `targetClose` implementation is colocated at `src/core/target/infra/target-eval.ts:442`.
  - File size is `494` LOC (`wc -l`).
- Problem:
  - Extract logic depends on eval module internals; eval module also carries unrelated close behavior.
- Refactor slice:
  - Move `parseJsonObjectText` into a shared parser utility (`core/shared/...`).
  - Move `targetClose` into `target-close.ts`.
- Expected impact:
  - Cleaner dependency graph and narrower files per command.
- Risk if ignored:
  - Higher chance of accidental breakage across command boundaries.

### A2-MAIN-006 - `browser.ts` is a multi-responsibility module (discovery, process control, session lifecycle)
- Category: coupling, cohesion, oversized-file
- Evidence:
  - Browser discovery candidates: `src/core/browser.ts:54`.
  - Process lifecycle/kill handling: `src/core/browser.ts:193` and `:229`.
  - Session startup orchestration: `src/core/browser.ts:268`.
  - Session reachability/default-session orchestration: `src/core/browser.ts:371` and `:437`.
  - File size is `484` LOC (`wc -l`).
- Problem:
  - Platform process concerns and session policy concerns are tightly coupled in one module.
- Refactor slice:
  - Split into `browser-discovery`, `browser-process`, and `managed-session-lifecycle` modules.
- Expected impact:
  - Reduced change blast radius for platform-specific fixes.
- Risk if ignored:
  - Harder debugging when startup/attach/pid cleanup issues overlap.

### A2-MAIN-007 - Runtime command wiring remains a large repetitive file
- Category: readability-debt, duplication, oversized-file
- Evidence:
  - File size is `491` LOC: `src/features/runtime/register-commands.ts`.
  - Repeated wrapper pattern appears many times:
    - `const output = ctx.globalOutputOpts();` at lines `62`, `82`, `114`, `127`, `140`, `155`, `213`, `249`, `271`, `295`, `319`, `340`, `356`, `371`, `448`.
    - `ctx.handleFailure(error, output);` at lines `68`, `104`, `119`, `132`, `145`, `160`, `236`, `257`, `282`, `306`, `330`, `348`, `361`, `379`, `474`.
- Problem:
  - Boilerplate obscures command intent and inflates edit surface for routine changes.
- Refactor slice:
  - Add a small command-action wrapper helper (`withRuntimeAction`) and split registrations by domain (`register-open`, `register-session`, `register-run`).
- Expected impact:
  - Lower noise per command and clearer ownership boundaries.
- Risk if ignored:
  - Slower command evolution and copy-paste defects.

## Low

### A2-MAIN-008 - Target report types are centralized in one very large type file
- Category: oversized-file, readability-debt
- Evidence:
  - `src/core/types/target.ts` is `499` LOC.
  - The file holds many report contracts continuously from `:2` through `:499`.
- Problem:
  - Type edits for unrelated commands converge in one file, increasing navigation friction and merge conflict probability.
- Refactor slice:
  - Split report types by command area (`target-find.types.ts`, `target-extract.types.ts`, etc.) with a barrel export.
- Expected impact:
  - Better locality of contract changes.
- Risk if ignored:
  - Increasing churn concentration as new target commands are added.

## Follow-up Round 1 (New Findings)

## High

### A2-MAIN-009 - State read failures silently reset to empty state, enabling accidental state loss on next write
- Category: maintainability-risk, coupling
- Evidence:
  - Version mismatch path drops to empty state: `src/core/state/infra/state-store.ts:206-208`.
  - Any read/parse failure also drops to empty state: `src/core/state/infra/state-store.ts:270-271`.
  - `updateState` then persists whatever was read/mutated back to disk: `src/core/state/infra/state-store.ts:309-314`.
- Problem:
  - A transient/corrupt read path can silently convert a rich state into an empty baseline and then persist it, making diagnosis and recovery difficult.
- Refactor slice:
  - Introduce typed state-read errors with explicit corruption/version codes, plus quarantine/back-up behavior before write.
  - Keep `emptyState` only for first-run/no-file cases, not for parse/version failures.
- Expected impact:
  - Prevents silent destructive rewrites and improves incident triage.
- Risk if ignored:
  - Intermittent state corruption can become durable data loss after normal mutations.

### A2-MAIN-010 - Daemon metadata parsing/security logic is duplicated across client and worker with inconsistent validation
- Category: duplication, coupling
- Evidence:
  - Duplicated helpers in both files:
    - `parsePositiveInt`: `src/core/daemon/infra/daemon.ts:83`, `src/core/daemon/infra/worker.ts:35`
    - `currentProcessUid`: `src/core/daemon/infra/daemon.ts:91`, `src/core/daemon/infra/worker.ts:43`
    - `readDaemonMeta`: `src/core/daemon/infra/daemon.ts:103`, `src/core/daemon/infra/worker.ts:55`
    - `removeDaemonMeta`: `src/core/daemon/infra/daemon.ts:160`, `src/core/daemon/infra/worker.ts:92`
  - Validation drift already exists:
    - client requires non-empty `startedAt`: `src/core/daemon/infra/daemon.ts:124-126`
    - worker does not require it and allows empty fallback: `src/core/daemon/infra/worker.ts:68-76`, `:85`
- Problem:
  - Control-plane metadata rules can diverge over time between daemon launcher and worker cleanup paths.
- Refactor slice:
  - Extract a shared `daemon-meta` module for schema validation, permission checks, read/write/remove.
  - Add one contract test suite against that shared module rather than parallel implementations.
- Expected impact:
  - One canonical metadata contract and lower drift risk.
- Risk if ignored:
  - Inconsistent daemon behavior under stale/partial metadata conditions.

## Medium

### A2-MAIN-011 - Pipeline alias proliferation increases change surface and validation branching
- Category: readability-debt, duplication
- Evidence:
  - Alias step IDs are all accepted in core type list (`scroll-plan` + `scrollPlan`, `repeat-until` + `repeatUntil`, `click-read` + `clickRead`): `src/core/pipeline-support/infra/plan-types.ts:7-14`.
  - Lint logic carries repeated alias condition branches: `src/core/pipeline-support/infra/plan-lint.ts:126`, `:135`, `:193`, `:206`.
  - Executor map includes alias trampolines: `src/core/pipeline/infra/execute-shared.ts:130`, `:289`, `:344`.
  - Runtime contract command still keeps deprecated alias behavior (`--compact`): `src/features/runtime/register-commands.ts:76`, `:88`.
- Problem:
  - Back-compat aliases multiply branch points and maintenance burden for every step/command evolution.
- Refactor slice:
  - Canonicalize to one ID/form per step/flag at parse boundary; emit typed error or one-time migration guidance for legacy forms.
- Expected impact:
  - Smaller validator/executor branching and cleaner future step additions.
- Risk if ignored:
  - Alias matrix keeps growing and slows every pipeline contract change.

### A2-MAIN-012 - `execute-shared.ts` is an oversized mixed-responsibility execution engine
- Category: complexity, cohesion, oversized-file
- Evidence:
  - File size: `451` LOC.
  - One giant `PIPELINE_STEP_EXECUTORS` map starts at `src/core/pipeline/infra/execute-shared.ts:63`.
  - Complex nested `repeat-until` DSL execution lives inline in same map: `:131-287`.
- Problem:
  - Step parsing/validation, control-flow (`repeat-until`), and command dispatch are tightly mixed.
- Refactor slice:
  - Split by step family (`navigation`, `query`, `action`, `control-flow`) and move repeat-until engine into dedicated module.
- Expected impact:
  - Lower cognitive load and safer changes to control-flow semantics.
- Risk if ignored:
  - Higher regression probability when adding/editing steps.

### A2-MAIN-013 - `run-ops.ts` has broad pass-through duplication and weakly typed result casting
- Category: duplication, readability-debt
- Evidence:
  - File size: `422` LOC (`src/core/pipeline/app/run-ops.ts`).
  - Many repeated casts to `Record<string, unknown>`: lines `29`, `31`, `52`, `76`, `98`, `122`, `174`, `293`, `337`, `359`, `381`, `401`, `419`.
  - Each op re-declares large near-duplicate input object shapes before forwarding.
- Problem:
  - Adapter layer is verbose, repetitive, and relies on broad casts that reduce type-level maintainability.
- Refactor slice:
  - Introduce typed adapter factories (`makeQueryOp`, `makeActionOp`) with shared forwarding helpers and narrower per-op deltas.
- Expected impact:
  - Less boilerplate and clearer typed boundaries between pipeline and target/session APIs.
- Risk if ignored:
  - Rising edit tax and hidden type drift as more ops are added.
