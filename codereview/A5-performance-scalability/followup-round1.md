# Follow-up Round 1 (A5)

## Q1) What else can we improve?

A: Yes. Beyond the first round, these are high-leverage improvements:

1. Bound daemon response memory and output size earlier.
- Why: Current path buffers output in memory before transport-size checks.
- Evidence: `src/core/request-context.ts:125-127`, `src/core/request-context.ts:138-139`, `src/core/daemon/app/run-orchestrator.ts:21`, `src/core/daemon/app/run-orchestrator.ts:49-50`, `src/core/daemon/infra/daemon-transport.ts:3`, `src/core/daemon/infra/daemon-transport.ts:140-147`.

2. Reduce scheduler control-plane overhead for high lane counts.
- Why: Runnable-lane selection repeatedly allocates/scans lane-key arrays per scheduling pass.
- Evidence: `src/core/daemon/domain/lane-scheduler.ts:82-97`, `src/core/daemon/domain/lane-scheduler.ts:106-138`.

3. Add bounded eviction for CDP reachability cache.
- Why: Cache TTL is freshness-only, not capacity/eviction bounded.
- Evidence: `src/core/browser/infra/cdp-endpoint.ts:9`, `src/core/browser/infra/cdp-endpoint.ts:205-207`, `src/core/browser/infra/cdp-endpoint.ts:211`, `src/core/browser/infra/cdp-endpoint.ts:222`.

4. Keep pushing on existing top bottlenecks from round 1.
- Why: global prune-on-ensure and full-state rewrite under lock remain the biggest scaling multipliers.
- Evidence: `src/core/session/public.ts:114`, `src/core/state/infra/maintenance-session-prune.ts:145-149`, `src/core/state/infra/state-store.ts:309-314`.

## Q2) Any critical performance/scaling risk we should treat as urgent?

A: Yes. Treat these as urgent now:

1. `A5-001` (`sessionEnsure` global prune hot path).
- Urgency rationale: user-facing command latency scales with total sessions due to serial reachability probes.
- Evidence: `src/core/session/public.ts:112-114`, `src/core/state/infra/maintenance-session-prune.ts:145-149`.

2. `A5-002` (full-state read/normalize/rewrite on every mutation under one lock).
- Urgency rationale: this compounds across nearly all mutations and creates systemic contention risk.
- Evidence: `src/core/state/infra/state-store.ts:200-258`, `src/core/state/infra/state-store.ts:309-314`, `src/core/state/infra/state-lock.ts:164-179`.

3. `A5-008` (daemon output aggregation memory amplification + late oversize failure).
- Urgency rationale: failure mode is abrupt under larger outputs and can destabilize daemon responsiveness.
- Evidence: `src/core/request-context.ts:125-127`, `src/core/request-context.ts:138-139`, `src/core/daemon/infra/daemon-transport.ts:140-147`.

## Q3) What should we improve now to keep maintainability while scaling?

A: Implement a maintainability-first short list (minimal surface complexity, high impact):

1. Introduce batched state mutation APIs and migrate obvious N-write loops first.
- First target: `targetList` snapshot persistence loop.
- Evidence: `src/core/target/infra/targets.ts:396-406`, `src/core/state/infra/state-store.ts:309-314`.
- Maintainability gain: one clear state-write contract per operation, fewer hidden lock interactions.

2. Split health-check responsibility from cleanup responsibility.
- Change: `sessionEnsure` should ensure one session; global cleanup stays in explicit/background maintenance.
- Evidence: `src/core/session/public.ts:112-114`, `src/core/state/infra/maintenance-session-prune.ts:127-154`.
- Maintainability gain: cleaner command semantics and easier performance reasoning.

3. Add bounded cache/output policies as reusable primitives.
- Scope: daemon response output budget + truncation envelope; bounded CDP reachability cache.
- Evidence: `src/core/request-context.ts:125-139`, `src/core/daemon/infra/daemon-transport.ts:3`, `src/core/browser/infra/cdp-endpoint.ts:9`.
- Maintainability gain: explicit limits in shared infra instead of ad-hoc behavior in feature commands.

4. Tighten benchmark discipline to executable gates for hot paths.
- Evidence: `scripts/perf-budget-check.mjs:44-47`, `scripts/perf-budget-check.mjs:68-74`.
- Maintainability gain: regressions are caught by runtime checks, reducing subjective post-hoc tuning.
