# State Store and Migrations

## Problem

SurfWright needs durable state (sessions, targets, capture indexes) but must remain resilient across restarts and upgrades. If state schema changes are implicit or ad-hoc, old installs wedge, agents get inconsistent behavior, and debugging becomes guesswork.

## Design Goals

- State is explicitly versioned and migrated forward on read.
- State location is deterministic and agent-scopeable (supports parallel agents without collisions).
- State mutation is restricted to a narrow repo layer (policy-enforced).
- Maintenance commands exist to reconcile/prune state instead of “silent repairs” scattered across call sites.

## Non-goals

- State is not a general database layer.
- We do not do implicit background schema upgrades at random call sites.

## Where the Logic Lives

- Migration source of truth:
  - `src/core/state/domain/migrations.ts` (`migrateStatePayload`)
- State storage boundary (JSON.parse allowlisted as a boundary):
  - `src/core/state/infra/state-store.ts`
    - `stateRootDir()` (scoping rules)
    - `readState()` (read + migrate + normalize)
    - lock file constants (guards concurrent writers)
- State mutation layer (restricted by policy):
  - `src/core/state/repo/**`
  - enforced by `policy/config.json` (`state-boundaries`)
- Contract + guardrail tests:
  - `test/state-maintenance.contract.test.mjs` (legacy payloads migrate before maintenance commands run)

## Runtime Flow

1. Choose state root:
   - If `SURFWRIGHT_STATE_DIR` is set, it wins (`src/core/state/infra/state-store.ts`).
   - Otherwise, state root is:
     - `~/.surfwright/agents/<agentId>` when `SURFWRIGHT_AGENT_ID` is set, or
     - `~/.surfwright` when not agent-scoped.
2. Read state:
   - Read `state.json`, `JSON.parse`, then run `migrateStatePayload(...)`.
   - If parsing/migration fails, fall back to an empty state envelope.
3. Normalize:
   - Normalize sessions/targets/captures into the current `STATE_VERSION` shape.
4. Mutate and write (restricted):
   - Mutations are implemented in `src/core/state/repo/**` and persisted via the state store.
   - Policy restricts which modules can import mutation bindings (`ARC003` in `policy/config.json`).

## Invariants / Guardrails

- No implicit upgrades:
  - Schema upgrades are expressed only as ordered migrations in `src/core/state/domain/migrations.ts`.
  - If a migration is missing for a version, migration fails (treat as incompatible/corrupt).
- Agent scoping is explicit:
  - `--agent-id` (via `SURFWRIGHT_AGENT_ID`) changes the state root directory, and therefore the daemon/session namespace.
- Concurrency is bounded:
  - Writes are guarded via a lock file strategy in the state store (`src/core/state/infra/state-store.ts`).
- Maintenance is explicit:
  - Reconcile/prune behavior should live in explicit runtime commands (for example `state reconcile`, `target prune`, `session prune`) instead of hidden “fix-ups” on unrelated command paths.

## Observability

- State root is explainable and reproducible:
  - set `SURFWRIGHT_STATE_DIR` to pin it for tests or debugging.
  - set `--agent-id` to isolate a run.
- Contract tests encode migration expectations (legacy -> current) (`test/state-maintenance.contract.test.mjs`).

## Testing Expectations

- Legacy payloads migrate forward before maintenance commands run (`test/state-maintenance.contract.test.mjs`).
- Migration behavior is deterministic: same input state yields the same migrated envelope.

