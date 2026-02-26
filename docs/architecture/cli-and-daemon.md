# CLI and Daemon Proxy

## Problem

SurfWright is both an operator CLI and an agent-driven automation surface. The CLI must stay fast and deterministic, but spawning Node + wiring Commander + resolving features on every command adds latency. A daemon can amortize that cost, but it must not break streaming commands or JSON contract guarantees.

## Design Goals

- Keep the user-visible CLI contract stable:
  - JSON output is the default, and is stdout-only.
  - use `--no-json` for human-friendly summaries.
  - failures are typed (`code` + `message`) without stack traces by default.
- Make the “common case” fast by default via daemon proxying.
- Preserve low-latency streaming for tail-style commands by bypassing the daemon.
- Keep state and daemon identity explicitly scoped by `--agent-id` (no implicit “current agent”).

## Non-goals

- The daemon is not a general plugin runtime.
- The daemon is not an API server with a stable external protocol. It is an internal optimization for the CLI.
- We do not attempt to make every command daemon-safe (streaming is intentionally direct).

## Where the Logic Lives

- CLI orchestration + daemon bypass:
  - `src/cli.ts`
    - dot-alias rewriting: `rewriteDotCommandAlias` (driven by `allCommandManifest`)
    - bypass routing: `shouldBypassDaemon`
    - worker entrypoints: `maybeRunInternalWorker` (`__network-worker`, `__daemon-worker`, `__maintenance-worker`)
    - proxy attempt: `runViaDaemon(...)` then fallback to local
- Feature manifest aggregation (drives dot aliases + contract):
  - `src/features/registry.ts` (`allCommandManifest`, `registerFeaturePlugins`)
- Daemon proxy implementation:
  - `src/core/daemon/infra/daemon.ts` (`runViaDaemon`, meta at `stateRootDir()/daemon.json`)
  - `src/core/daemon/infra/worker.ts` (`parseDaemonWorkerArgv`, `runDaemonWorker`)
  - `src/core/daemon/public.ts` (approved core facade import for features)
- Streaming network worker:
  - `src/cli.ts` (`__network-worker` entrypoint)
  - `src/features/network/index.ts` (`parseWorkerArgv`, `runTargetNetworkWorker`)
  - `src/core/target/infra/network/target-network-capture.ts` (spawns `__network-worker`)

## Daemon Layer Ownership Map

| Layer | Ownership | Must not own |
| --- | --- | --- |
| `infra` (`src/core/daemon/infra/*`) | Socket transport, framing, token gate, worker process lifecycle, daemon client I/O | Command-family routing policy, lane scheduling rules, runtime pool state transitions |
| `app` (`src/core/daemon/app/*`) | Request orchestration, command-family classification, daemon outcome mapping to caller contract | TCP framing details, raw socket parsing, persistent pool internals |
| `domain` (`src/core/daemon/domain/*`) | Scheduler contracts, lane-key rules, runtime-pool state model/invariants | Direct network I/O, process spawning, CLI formatting concerns |

Implemented Lean v1 boundary path:

1. `infra/worker.ts` performs frame parsing + one-request connection handling.
2. `app/worker-request-orchestrator.ts` owns request-kind validation/classification and token checks.
3. `app/run-orchestrator.ts` owns request-local command execution/capture and delegates queueing through domain scheduler contracts.
4. `domain/*` owns lane resolver/scheduler/pool policy contracts and invariants.

## Runtime Flow

1. Normalize argv (CLI front door):
   - `src/cli.ts` rewrites dot-command aliases like `target.snapshot` into `target snapshot`.
   - `--agent-id` is parsed early and applied by mutating `process.env.SURFWRIGHT_AGENT_ID` so downstream state/daemon paths are scoped consistently.
2. Internal worker short-circuit:
   - If argv[2] is `__network-worker` or `__daemon-worker`, run worker mode directly and exit.
3. Decide daemon bypass:
   - `shouldBypassDaemon(...)` returns true for:
     - internal commands (`__*`)
     - streaming tails: `target network-tail`, `target console-tail`
     - `run --plan -` (stdin plan; avoid buffering/forwarding complexity)
4. If not bypassed, attempt daemon proxy:
   - `runViaDaemon(...)` starts or reuses the daemon (meta stored at `stateRootDir()/daemon.json`).
   - The daemon sends back captured `stdout`/`stderr` + exit `code` and the CLI forwards them verbatim.
5. Fallback to local execution:
   - If proxying is disabled or fails, execute locally via Commander registration (`registerFeaturePlugins`).

## Queue Overload Contract (CLI Surface)

| Condition | CLI failure code | Deterministic meaning |
| --- | --- | --- |
| Request exceeded daemon queue wait budget before dispatch | `E_DAEMON_QUEUE_TIMEOUT` | Queue wait expired under contention. |
| Request rejected because lane queue depth cap was reached | `E_DAEMON_QUEUE_SATURATED` | Queue depth cap prevented enqueue. |

## Daemon Outcome Fallback Contract

| Outcome class | Fallback eligibility | CLI behavior |
| --- | --- | --- |
| Queue overload (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) | No | Return typed queue failure directly to stdout JSON; do not run local fallback. |
| Daemon unreachable (transport/startup/connectivity failure) | Yes | Run local command path and preserve CLI contract envelope. |

## Scheduler Semantics (Lean v1 Defaults)

- lane key precedence for daemon `run`: `sessionId -> cdpOrigin -> control:default`
- per-session lane concurrency: `1` (same session stays serialized cross-process)
- global active lane cap: `8`
- per-lane queue depth cap: `8`
- queue wait budget: `2000ms`
- non-session work is routed to bounded `control:default` lane
- scheduler is fairness-oriented across runnable lanes; one stalled lane must not starve unrelated lanes
- queue wait expiry maps only to `E_DAEMON_QUEUE_TIMEOUT`
- queue depth rejection maps only to `E_DAEMON_QUEUE_SATURATED`

## Runtime Access Semantics

- `src/core/session/infra/runtime-access.ts` is the canonical runtime entry for session browser operations.
- `withSessionBrowser` / `acquireSessionBrowser` provide explicit acquire/release boundaries for all `open` and `target.*` runtime paths.
- direct `chromium.connectOverCDP(...)` usage in `src/core` is restricted to the runtime-access abstraction module (enforced by migration contract tests).

## Runtime Pool And State Machine Semantics

- runtime pool implementation: `src/core/session/infra/runtime-pool.ts`
- pool capacity policy: `maxEntries=64`, idle-entry LRU eviction, and uncached one-off execution when all entries are busy
- pool states: `absent`, `warming`, `ready`, `degraded`, `draining`, `closed`
- key transition contracts:
  - `absent -> warming -> ready` on healthy warm
  - `warming -> absent` on warm failure
  - `ready -> degraded` on timeout/stale runtime signal
  - `degraded -> warming` on reconnect attempt, `degraded -> closed` on reconnect failure
  - `ready -> draining -> closed -> absent` for eviction/recycle cleanup
- safety invariants:
  - no cross-session runtime borrowing (fail closed on mismatch)
  - no same-key double warm
  - borrowed runtimes are not evicted before release
  - timeout cancel/recycle paths force safe draining/close behavior

## Diagnostics Semantics

- sink implementation: `src/core/daemon/infra/diagnostics.ts`
- local-only persistence:
  - `<stateRoot>/diagnostics/daemon.ndjson` (events)
  - `<stateRoot>/diagnostics/daemon.metrics.ndjson` (metrics)
- verbose diagnostics are opt-in only when `SURFWRIGHT_DEBUG_LOGS=1`; default is off
- required metrics emitted in Lean v1 include:
  - `daemon_request_duration_ms`
  - `daemon_queue_wait_ms`
  - `daemon_queue_depth`
  - `daemon_queue_rejects_total`
  - `daemon_worker_rss_mb`
  - `daemon_session_isolation_breaks_total`
- verbose fields include bounded-safe forms of `requestId`, `sessionId`, `command`, `durationMs`, `result`, `errorCode`, `queueScope`, and `queueWaitMs`
- redaction policy: never emit raw daemon tokens/credentials in diagnostics output

## Security Semantics

- daemon listener is loopback-only (`127.0.0.1`)
- newline-delimited JSON framing with one request per connection
- frame caps are enforced at `4 MiB` for both request and response paths
- per-request daemon token validation is mandatory
- metadata hardening on POSIX:
  - strict mode check (`0600`)
  - strict ownership check (current user UID)
  - weak metadata is rejected and cleaned
- `SURFWRIGHT_DAEMON=0` is hard-off (no daemon spawn and no daemon proxy usage)
- daemon internals must not introduce unsolicited outbound network/telemetry paths

## Invariants / Guardrails

- Streaming commands bypass daemon:
  - `target network-tail` and `target console-tail` must remain direct to avoid daemon buffering latency/memory (`src/cli.ts`).
- JSON mode is stdout-only:
  - JSON failures are printed to stdout (not stderr) and are typed (`src/cli.ts` `printFailure(...)`).
  - Contract tests pin “no stack traces by default” in json-mode failures (`test/daemon.contract.test.mjs`).
- Explicit agent scoping:
  - `--agent-id` controls `SURFWRIGHT_AGENT_ID`, which affects state root selection and daemon meta namespace (`src/cli.ts`, `src/core/state/infra/state-store.ts`, `src/core/daemon/infra/daemon.ts`).
- Daemon is optional and must not wedge:
  - Proxying can be disabled via `SURFWRIGHT_DAEMON` (`src/core/daemon/infra/daemon.ts`).
  - Oversized request frames must be rejected without wedging (`test/daemon.contract.test.mjs`).

## Observability

- Daemon metadata:
  - `daemon.json` in the state root directory records `{ pid, host, port, token, startedAt }` (`src/core/daemon/infra/daemon.ts`).
- Deterministic typed failures:
  - CLI converts thrown errors into typed failures via `toCliFailure(...)` and prints in a stable shape (`src/cli.ts`).

## Testing Expectations

- Daemon behavior:
  - daemon starts and reuses the same worker across invocations (`test/daemon.contract.test.mjs`)
  - daemon idle timeout exits and clears metadata (`test/daemon.contract.test.mjs`)
  - oversized frames are rejected without wedging (`test/daemon.contract.test.mjs`)
- Dot alias routing stays truthful:
  - dot aliases route to registered commands and contract ids match Commander help traversal (`test/dot-alias.contract.test.mjs`)
