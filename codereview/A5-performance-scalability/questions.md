# A5 Follow-up Questions

1. What is the target upper bound for concurrently active sessions in real operator workflows (P50/P95), so we can size `sessionEnsure` and prune budgets correctly?
2. Should `sessionEnsure` guarantee global stale-session cleanup, or is it acceptable to make that behavior opt-in (`session prune`) plus background maintenance only?
3. For target-heavy sessions, what is the expected max open pages/tabs per session? This determines whether we prioritize a target-handle cache immediately.
4. Are we willing to change on-disk state format now (sharded files or append-log), or do you want an incremental path that preserves current `state.json` first?
5. Do you want `target list` persistence to remain default-on for every call, or should we default to `--no-persist` and persist only on explicit demand in high-scale loops?
6. Should completed network captures be retained by default for debugging, or should we enforce strict retention (age/count) with automatic pruning?
7. For daemon scaling, do you prefer hard deterministic queue limits (current behavior) or adaptive limits that trade determinism for higher throughput under bursty parallel agents?
8. Should performance gates in CI execute live command benchmarks (slower but realistic), or remain fixture-based with a separate required nightly perf pipeline?
