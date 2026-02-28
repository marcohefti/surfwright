# A5 Performance & Scalability Findings

Scope reviewed: hot paths, startup/runtime overhead, retries/timeouts, state growth, daemon/session scaling limits, benchmark discipline.
Method: static code-path audit with exact line-backed evidence only.

## Findings (ordered by severity)

### A5-001 (high) - `session ensure` does global sequential reachability pruning on the hot path
- Category: `hot_path`, `retries_timeouts`, `session_scaling`
- Problem:
  `open` and other shared-session flows call `sessionEnsure`, and `sessionEnsure` always runs `sessionPrune` first. `sessionPruneInternal` then probes every session serially with awaited CDP reachability checks.
- Evidence:
  - `src/core/session/public.ts:104`
  - `src/core/session/public.ts:112`
  - `src/core/session/public.ts:114`
  - `src/core/state/infra/maintenance.ts:163`
  - `src/core/state/infra/maintenance-session-prune.ts:137`
  - `src/core/state/infra/maintenance-session-prune.ts:145`
  - `src/core/state/infra/maintenance-session-prune.ts:149`
  - `src/core/state/infra/maintenance-session-prune.ts:132`
  - `src/core/state/infra/maintenance-session-prune.ts:134`
- Recommendation:
  Remove global prune from `sessionEnsure` hot path. Check only the requested/active session inline, and move full prune to bounded opportunistic/background maintenance with an explicit budget.
- Risk if ignored:
  Latency grows with session count and unreachable-session incidence; commands hit timeout walls under multi-session workloads.
- Effort: `M`

### A5-002 (high) - full-state JSON parse/normalize + full rewrite under one global lock on every mutation
- Category: `state_growth`, `runtime_overhead`, `contention`
- Problem:
  Every `updateState` call takes a global file lock, reads/parses/normalizes the full state object graph, then writes the full pretty-printed JSON file atomically.
- Evidence:
  - `src/core/state/infra/state-store.ts:309`
  - `src/core/state/infra/state-store.ts:311`
  - `src/core/state/infra/state-store.ts:313`
  - `src/core/state/infra/state-store.ts:200`
  - `src/core/state/infra/state-store.ts:210`
  - `src/core/state/infra/state-store.ts:225`
  - `src/core/state/infra/state-store.ts:242`
  - `src/core/state/infra/state-store.ts:251`
  - `src/core/state/infra/state-store.ts:280`
  - `src/core/state/infra/state-store.ts:300`
  - `src/core/state/infra/state-store.ts:301`
- Recommendation:
  Split state by domain/session (or move to append-log + compaction), and batch mutations to minimize lock duration and write amplification. Keep runtime writes compact (no pretty-print path in hot writes).
- Risk if ignored:
  Throughput degrades as state grows; lock contention and `E_STATE_LOCK_TIMEOUT` risk increase under parallel agents.
- Effort: `L`

### A5-003 (high) - target resolution is O(total pages) with per-page CDP calls for each action
- Category: `hot_path`
- Problem:
  `resolveTargetHandle` rebuilds target mapping by enumerating all contexts/pages and creating a CDP session per page to read target IDs.
- Evidence:
  - `src/core/target/infra/targets.ts:297`
  - `src/core/target/infra/targets.ts:304`
  - `src/core/target/infra/targets.ts:281`
  - `src/core/target/infra/targets.ts:286`
  - `src/core/target/infra/targets.ts:254`
  - `src/core/target/infra/targets.ts:255`
  - `src/core/target/infra/targets.ts:286`
  - `src/core/target/infra/network/target-network.ts:112`
- Recommendation:
  Introduce a per-session target handle cache keyed by `targetId` with invalidation on page/context lifecycle events, and use fallback rescan only on cache miss.
- Risk if ignored:
  Action latency scales linearly with tab count; high-CDP chatter worsens under multi-tab operator sessions.
- Effort: `M`

### A5-004 (high) - `target list` persists snapshots via N sequential state mutations
- Category: `hot_path`, `runtime_overhead`
- Problem:
  `targetList` iterates targets and awaits `saveTargetSnapshot` one-by-one; each call flows into `updateState`, multiplying full-state lock/read/write work by target count.
- Evidence:
  - `src/core/target/infra/targets.ts:396`
  - `src/core/target/infra/targets.ts:397`
  - `src/core/target/infra/targets.ts:398`
  - `src/core/state/repo/target-repo.ts:27`
  - `src/core/state/repo/target-repo.ts:28`
  - `src/core/state/infra/state-store.ts:393`
  - `src/core/state/infra/state-store.ts:394`
  - `src/core/state/infra/state-store.ts:309`
- Recommendation:
  Batch target snapshot persistence into one mutation (`mutateState` once per list operation) rather than per-target writes.
- Risk if ignored:
  `target list` cost grows superlinearly in practical runs (targets x state size), amplifying contention and wall time.
- Effort: `S-M`

### A5-005 (medium-high) - daemon queue saturation behavior is rigid and easy to trip under fan-out
- Category: `daemon_scaling_limits`, `retries_timeouts`
- Problem:
  Daemon scheduler defaults are strict (8 active lanes, 8 queue depth, 2s queue wait). Client retries queue-pressure errors only 2 times with 60ms delay, then fails.
- Evidence:
  - `src/core/daemon/domain/lane-scheduler.ts:3`
  - `src/core/daemon/domain/lane-scheduler.ts:4`
  - `src/core/daemon/domain/lane-scheduler.ts:5`
  - `src/core/daemon/domain/lane-scheduler.ts:159`
  - `src/core/daemon/domain/lane-scheduler.ts:164`
  - `src/core/daemon/domain/lane-scheduler.ts:186`
  - `src/core/daemon/infra/daemon.ts:15`
  - `src/core/daemon/infra/daemon.ts:16`
  - `src/core/daemon/infra/daemon.ts:399`
  - `src/core/daemon/infra/daemon.ts:411`
  - `src/core/daemon/infra/daemon.ts:413`
- Recommendation:
  Add adaptive/backpressure-aware queueing and jittered retry policy tied to observed queue wait telemetry; expose safe tuning knobs per deployment profile.
- Risk if ignored:
  Parallel agent bursts produce avoidable typed failures (`E_DAEMON_QUEUE_TIMEOUT`/`E_DAEMON_QUEUE_SATURATED`) before useful work executes.
- Effort: `M`

### A5-006 (medium-high) - network capture state has no bounded lifecycle; query fallback scans entire capture/artifact sets
- Category: `state_growth`, `hot_path`
- Problem:
  Capture records are created and finalized, but not removed on normal completion. Default source resolution scans all capture/artifact entries and hits filesystem existence checks before selecting latest source.
- Evidence:
  - `src/core/state/repo/network-capture-repo.ts:19`
  - `src/core/state/repo/network-capture-repo.ts:37`
  - `src/core/target/infra/network/target-network-capture.ts:351`
  - `src/core/target/infra/network/target-network-capture.ts:355`
  - `src/core/state/repo/network-capture-repo.ts:74`
  - `src/core/target/infra/network/target-network-capture.ts:210`
  - `src/core/target/infra/network/target-network-capture.ts:224`
  - `src/core/target/infra/network/target-network-source.ts:301`
  - `src/core/target/infra/network/target-network-source.ts:302`
  - `src/core/target/infra/network/target-network-source.ts:303`
  - `src/core/target/infra/network/target-network-source.ts:316`
  - `src/core/target/infra/network/target-network-source.ts:317`
  - `src/features/network/manifest.ts:34`
  - `src/features/network/manifest.ts:52`
- Recommendation:
  Add first-class capture-retention pruning (age/count) for `state.networkCaptures` plus stale-path compaction; keep default-source lookup bounded (e.g., indexed latest pointers).
- Risk if ignored:
  Persistent state growth increases read/scan cost and slow path filesystem checks for network-query/trace operations.
- Effort: `M`

### A5-007 (medium) - current perf gate validates static fixture timings, not live runtime behavior
- Category: `benchmark_discipline`
- Problem:
  `perf:check` compares committed fixture `observed.timingMs` against budgets instead of executing commands during the check.
- Evidence:
  - `package.json:25`
  - `package.json:39`
  - `scripts/perf-budget-check.mjs:44`
  - `scripts/perf-budget-check.mjs:47`
  - `scripts/perf-budget-check.mjs:57`
  - `scripts/perf-budget-check.mjs:68`
  - `scripts/perf-budget-check.mjs:72`
  - `test/fixtures/perf/budgets.json:3`
- Recommendation:
  Add executable perf checks in CI (cold + warm), track percentile envelopes and variance bands, and expand budget coverage beyond single-case fixture timing.
- Risk if ignored:
  Runtime regressions can pass CI if fixture timings are stale or unrepresentative.
- Effort: `M`

## Phased optimization recommendations

### Phase 0 (immediate, low-risk)
1. Batch `target list` snapshot writes into one state mutation (`A5-004`).
2. Stop mandatory global prune inside `sessionEnsure`; keep explicit `session prune` command for full sweeps (`A5-001`).
3. Add runtime metrics around `readState/updateState` bytes+duration+lock wait to baseline write amplification (`A5-002`).

### Phase 1 (state & session scaling)
1. Partition state persistence by domain/session to reduce full-file churn (`A5-002`).
2. Add bounded retention/compaction for `networkCaptures` state and stale file references (`A5-006`).
3. Replace serial reachability probing with bounded parallelism + hard per-sweep budget (`A5-001`).

### Phase 2 (hot-path runtime)
1. Introduce target-handle cache with deterministic invalidation (`A5-003`).
2. Rework daemon queue policy to adaptive limits and retry behavior informed by queue metrics (`A5-005`).

### Phase 3 (benchmark discipline hardening)
1. Promote executable perf checks to first-class CI gates and enforce percentile-based budgets (`A5-007`).
2. Require repeat sampling for optimize-iteration acceptance when deltas are small/noisy (`A5-007`).

## Groundrules compliance check
- page-specific optimization avoided: **yes**
- kind-of-page optimization avoided: **yes**
- cross-site benefit explained: **yes**
- evidence cited: **yes**

## Round 1 - Additional Findings

### A5-008 (high) - daemon path captures full stdout/stderr in-memory and applies frame-size failure late
- Category: `runtime_overhead`, `daemon_scaling_limits`
- Problem:
  Daemon command execution captures output chunks into arrays, joins into full strings, JSON-serializes response payload, and only then relies on transport frame-size enforcement (4 MB). This creates avoidable memory amplification and late failure behavior for large outputs.
- Evidence:
  - `src/core/request-context.ts:125`
  - `src/core/request-context.ts:126`
  - `src/core/request-context.ts:127`
  - `src/core/request-context.ts:59`
  - `src/core/request-context.ts:69`
  - `src/core/request-context.ts:138`
  - `src/core/request-context.ts:139`
  - `src/core/daemon/app/run-orchestrator.ts:21`
  - `src/core/daemon/app/run-orchestrator.ts:49`
  - `src/core/daemon/app/run-orchestrator.ts:50`
  - `src/core/daemon/infra/worker.ts:240`
  - `src/core/daemon/infra/daemon-transport.ts:3`
  - `src/core/daemon/infra/daemon-transport.ts:96`
  - `src/core/daemon/infra/daemon-transport.ts:140`
  - `src/core/daemon/infra/daemon-transport.ts:146`
- Recommendation:
  Introduce bounded daemon-output envelopes (typed truncation + byte counters) before aggregation, and stream or chunk large payloads for non-stream commands.
- Risk if ignored:
  Large responses can cause daemon-side/client-side memory spikes and transport rejection instead of deterministic bounded output.
- Effort: `M`

### A5-009 (medium) - daemon lane scheduler repeatedly materializes/scans lane keys on dispatch
- Category: `daemon_scaling_limits`, `hot_path`
- Problem:
  Scheduler picks runnable lanes by rebuilding `Array.from(lanes.keys())` and linear scanning each scheduling cycle; this repeats on task completion and queue timeout paths.
- Evidence:
  - `src/core/daemon/domain/lane-scheduler.ts:50`
  - `src/core/daemon/domain/lane-scheduler.ts:82`
  - `src/core/daemon/domain/lane-scheduler.ts:87`
  - `src/core/daemon/domain/lane-scheduler.ts:106`
  - `src/core/daemon/domain/lane-scheduler.ts:136`
  - `src/core/daemon/domain/lane-scheduler.ts:187`
- Recommendation:
  Keep a dedicated runnable-lane queue/ring and update it incrementally on enqueue/dequeue instead of full-key materialization per schedule pass.
- Risk if ignored:
  Scheduler control-plane overhead grows with lane cardinality, increasing queue latency under high session/agent fan-out.
- Effort: `M`

### A5-010 (medium) - CDP reachability cache can grow unbounded in long-lived daemon processes
- Category: `state_growth`, `runtime_overhead`
- Problem:
  `cdpReachabilityCache` is a process-global `Map`; TTL controls freshness checks but does not evict old keys unless the same key is re-probed and fails.
- Evidence:
  - `src/core/browser/infra/cdp-endpoint.ts:9`
  - `src/core/browser/infra/cdp-endpoint.ts:205`
  - `src/core/browser/infra/cdp-endpoint.ts:211`
  - `src/core/browser/infra/cdp-endpoint.ts:222`
  - `src/core/browser/infra/cdp-endpoint.ts:217`
  - `src/core/browser/infra/cdp-endpoint.ts:224`
- Recommendation:
  Replace with bounded TTL+LRU cache and perform periodic/sampled eviction; clear entries on session prune/clear events when possible.
- Risk if ignored:
  Long-running daemons handling many distinct CDP origins accumulate stale cache keys and unnecessary memory overhead.
- Effort: `S-M`
