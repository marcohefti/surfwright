# Contract Diff Approvals

Use this log when `test/fixtures/contract/contract.snapshot.json` changes.

Required entry format:
- `## YYYY-MM-DD`
- `Scope:`
- `Rationale:`
- `Artifacts:`

## 2026-02-26
Scope: Daemon architecture execution plan completion (Phase 11 contract diff gate).
Rationale: Baseline and post-change contract snapshots diverged by intentional daemon-surface completion updates; diff reviewed and approved with typed-failure and queue-code invariants preserved.
Artifacts: `tmp/daemon-concept/artifacts/contract-baseline-head.json`, `tmp/daemon-concept/artifacts/contract-post-change.json`, `tmp/daemon-concept/artifacts/contract-snapshot.diff`, `tmp/daemon-concept/artifacts/phase11-contract-diff-approval.md`

## 2026-02-28
Scope: State read hardening + contract error surface update.
Rationale: State file read/version failures were changed from silent reset to typed failure + quarantine behavior; contract error set intentionally added state read/version codes and regenerated snapshot + skill fingerprint.
Artifacts: `test/fixtures/contract/contract.snapshot.json`, `test/fixtures/contract/errors.json`, `src/core/state/infra/state-store.ts`, `src/core/contracts/error-contracts.ts`
