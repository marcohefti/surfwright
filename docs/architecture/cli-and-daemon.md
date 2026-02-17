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
    - worker entrypoints: `maybeRunInternalWorker` (`__network-worker`, `__daemon-worker`)
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
