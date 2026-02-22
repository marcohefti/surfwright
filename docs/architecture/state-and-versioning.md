# State Store and Versioning

## Problem

SurfWright needs durable state (sessions, targets, capture indexes) while staying deterministic for fresh agents and resilient to local corruption. If state upgrades happen implicitly, behavior drifts and failures become hard to explain.

## Design Goals

- State schema is explicit and strict: only current `STATE_VERSION` is accepted.
- State location is deterministic and agent-scopeable (parallel agent runs do not collide).
- State mutation is restricted to a narrow repo layer (policy-enforced).
- Maintenance commands reconcile/prune state explicitly instead of hidden repairs.

## Non-goals

- State is not a general database layer.
- SurfWright does not carry backward schema migration logic.

## Where the Logic Lives

- State storage boundary (JSON.parse allowlisted as a boundary):
  - `src/core/state/infra/state-store.ts`
    - `stateRootDir()` (scoping rules)
    - `readState()` (strict schema acceptance + normalization)
    - lock file constants (guards concurrent writers)
- State version constant:
  - `src/core/types.ts` (`STATE_VERSION`)
- State mutation layer (restricted by policy):
  - `src/core/state/repo/**`
  - enforced by `policy/config.json` (`state-boundaries`)
- Contract + guardrail tests:
  - `test/state-maintenance.contract.test.mjs`

## Runtime Flow

1. Choose state root:
   - If `SURFWRIGHT_STATE_DIR` is set, it wins (`src/core/state/infra/state-store.ts`).
   - Otherwise, state root is:
     - `~/.surfwright/agents/<agentId>` when `SURFWRIGHT_AGENT_ID` is set, or
     - `~/.surfwright` when not agent-scoped.
2. Read state:
   - Read `state.json` and `JSON.parse`.
   - Accept only object payloads whose `version` equals current `STATE_VERSION`.
   - Any invalid/unknown version payload is treated as incompatible and replaced by an empty envelope.
3. Normalize:
   - Normalize sessions/targets/captures into the current shape.
4. Mutate and write (restricted):
   - Mutations are implemented in `src/core/state/repo/**` and persisted via the state store.
   - Policy restricts which modules can import mutation bindings (`ARC003` in `policy/config.json`).

## Invariants / Guardrails

- No implicit upgrades:
  - Unknown or stale schema versions do not auto-upgrade.
  - Reads fall back to a clean empty state envelope when schema is incompatible.
- Agent scoping is explicit:
  - `--agent-id` (via `SURFWRIGHT_AGENT_ID`) changes the state root directory and daemon/session namespace.
- Concurrency is bounded:
  - Writes are guarded via a lock file strategy in the state store (`src/core/state/infra/state-store.ts`).
- Maintenance is explicit:
  - Reconcile/prune behavior lives in runtime commands (for example `state reconcile`, `state disk-prune`, `target prune`, `session prune`) rather than hidden schema/state shape rewrites.
  - Bounded opportunistic maintenance may run detached on command ingress for host hygiene (for example parking idle managed browser processes and pruning stale run/capture/profile artifacts) without changing command output contracts.

## Observability

- State root is explainable and reproducible:
  - set `SURFWRIGHT_STATE_DIR` to pin it for tests/debugging.
  - set `--agent-id` to isolate a run.
- Contract tests encode strict version acceptance behavior (`test/state-maintenance.contract.test.mjs`).

## Testing Expectations

- Incompatible or malformed persisted payloads reset to empty state (`test/state-maintenance.contract.test.mjs`).
- Current-schema payloads remain deterministic under maintenance commands.
