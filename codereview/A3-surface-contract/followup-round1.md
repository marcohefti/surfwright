# Follow-up Round 1 (A3)

## Q1) What else can be improved now?
A: Normalize failure semantics for all input-validation paths so operator mistakes never surface as internal faults.
- Evidence: plain `Error` in parse callbacks (`src/cli.ts:58-67`, `src/features/runtime/register-commands.ts:48-53`) is mapped to `E_INTERNAL` (`src/core/errors.ts:107-113`); repros return `E_INTERNAL` for invalid `--timeout-ms` / `--lease-ttl-ms`.

## Q2) Any critical surface/contract risks not yet called out?
A: Yes. CLI can emit daemon internal codes that are absent from `contract.errors`.
- Evidence: daemon emits `E_DAEMON_TOKEN_INVALID`/`E_DAEMON_REQUEST_INVALID`/`E_DAEMON_RUN_FAILED` (`src/core/daemon/app/worker-request-orchestrator.ts:64,89,124,161,173`; `src/core/daemon/infra/worker.ts:420`), CLI forwards typed daemon errors (`src/core/daemon/infra/daemon.ts:417-420`, `src/cli.ts:279-285`), but contract error list excludes these (`src/core/contracts/error-contracts.ts:3-70`).

## Q3) What improvements now will make this more maintainable/scalable?
A: Define one authoritative command-path resolver and reuse it for:
- diagnostics (`src/cli/commander-failure.ts:24-31`)
- daemon bypass/routing (`src/cli.ts:85-123`, `src/core/daemon/domain/lane-key-resolver.ts:49-64`)
- argv normalization (`src/cli/argv-normalize.ts:74-116`, `src/cli/argv-normalize.ts:340-380`)
Current duplicated heuristics already diverge on supported roots/depth (`src/cli/options.ts:101-106`).

## Q4) What can reduce docs/contract drift risk fastest?
A: Remove hidden compatibility rewrites or represent them explicitly in contract metadata.
- Evidence: rewrites in `src/cli/argv-normalize.ts:118-208` and `src/cli/argv-normalize.ts:211-337` accept grammar not encoded in manifest usage (`src/features/target-core/manifest.ts:19`, `src/features/runtime/manifest.ts:74`), while docs define contract-first discovery (`docs/architecture/contract-system.md:26-30`, `docs/architecture/contract-system.md:70-72`).

## Q5) What contract-governance hardening is worth doing now?
A: Pin compact list ordering semantics explicitly (or make ordering non-contractual in docs).
- Evidence: compact lists preserve manifest order (`src/features/runtime/contract-output.ts:99-100`, `src/features/registry.ts:99-101`), but fingerprint/snapshot checks sort entries (`src/core/cli-contract.ts:352-357`, `scripts/checks/contract-snapshot.mjs:70-87`), so reorder-only diffs can bypass gates.

## Q6) Is there a low-cost UX consistency win?
A: Enforce global output flag semantics uniformly for `extension.*`.
- Evidence: extension printer always JSON (`src/features/extensions/register-commands.ts:11-18`) despite global `--no-json` contract (`src/cli.ts:148-150`) and extension manifest advertising `[--no-json]` (`src/features/extensions/manifest.ts:6,11,16,21`).
