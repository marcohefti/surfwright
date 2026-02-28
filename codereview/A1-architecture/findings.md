# A1 Architecture Review

Scope: boundaries, layering, domain seams, dependency direction, and policy-conformance risks.
Method: static code/policy/doc review + policy harness runs (`pnpm -s policy:check`, `pnpm -s policy:check:strict`).

## High

### A1-ARCH-001: Daemon domain layer depends on CLI parsing utilities (dependency inversion)
Problem: `core/daemon/domain` is coupled to `src/cli/*`, so domain logic depends on surface parsing details.

Evidence:
- `src/core/daemon/domain/lane-key-resolver.ts:1` imports `parseCommandPath`, `parseGlobalOptionValue`, `parseOptionTokenSpan` from `src/cli/options.ts`.
- `docs/architecture/cli-and-daemon.md:48` says daemon `domain` must not own CLI formatting concerns.
- `policy/rules/core-layer-purity.mjs:83-92` only blocks `src/features/*` imports from core app/domain; imports from `src/cli/*` are not checked.

Recommendation:
- Near-term: move argv token parsing to `src/core/daemon/app/*` and pass a normalized command-intent object into domain lane resolution.
- Longer-term: define a typed `DaemonRequestIntent` contract at an app boundary and make domain accept only that contract.

Risk if ignored: daemon scheduling rules remain coupled to CLI token mechanics; non-CLI ingress (worker/tests/future API) will keep leaking surface concerns into domain behavior.

Effort: M

### A1-ARCH-002: Daemon app layer currently violates core purity (active policy failure)
Problem: app-layer orchestration imports Node runtime directly and a CLI helper.

Evidence:
- `src/core/daemon/app/run-orchestrator.ts:1` imports `node:process`.
- `src/core/daemon/app/run-orchestrator.ts:5` imports `parseOutputOptsFromArgv` from `src/cli/commander-failure.ts`.
- `policy/rules/core-layer-purity.mjs:67-75` forbids Node builtins in core app/domain.
- `pnpm -s policy:check` currently reports `[ARC008] src/core/daemon/app/run-orchestrator.ts`.

Recommendation:
- Near-term: pass pre-parsed output options from caller into orchestrator; move stdout/stderr formatting to infra adapter.
- Longer-term: isolate daemon app into pure orchestration over ports, with all process/stdio access in infra.

Risk if ignored: policy remains red, and app-layer orchestration keeps hard dependencies on process/CLI surface details.

Effort: S

### A1-ARCH-003: Core bounded-domain guarantees are bypassed by allowlisted cross-domain internals
Problem: baseline policy explicitly allows internal-to-internal cross-domain imports.

Evidence:
- `policy/config.json:75-81` allowlists internal cross-domain targets (`session/infra/runtime-access`, `daemon/infra/diagnostics`, `daemon/domain/diagnostics`).
- `src/core/session/infra/runtime-access.ts:4` imports `../../daemon/infra/diagnostics.ts`.
- `src/core/session/infra/runtime-pool.ts:2` imports `../../daemon/domain/diagnostics.ts`.
- `src/core/state/infra/maintenance-session-prune.ts:4` imports `../../session/infra/runtime-access.ts`.
- `policy/config.strict.json:65` reduces cross-domain allowance to `public/index` only; strict run emits many `ARC004` violations.

Recommendation:
- Near-term: add explicit cross-domain facades (for diagnostics/runtime access) and migrate import sites to `public`/`index` entrypoints.
- Longer-term: ratchet baseline `allowCrossDomainInternal` to strict-style `public/index` only.

Risk if ignored: bounded domains remain porous, and refactors inside one domain can break consumers in other domains.

Effort: L

### A1-ARCH-004: Public facades leak infra modules by exception
Problem: major `public.ts` surfaces re-export infra directly, and policy suppresses violations for those files.

Evidence:
- `src/core/target/public.ts:16-35` and `src/core/target/public.ts:51-66` export many `./infra/*` modules.
- `src/core/session/public.ts:33-34` imports `./infra/open.ts` and `./infra/doctor.ts`.
- `policy/config.json:210-216` allowlists these files in `allowInfraInFiles`.
- `policy/rules/architecture/public-surface-curation.mjs:64-66` skips checks for allowlisted files.

Recommendation:
- Near-term: introduce app-level adapter functions and route `public.ts` exports through app/domain symbols only.
- Longer-term: reduce `allowInfraInFiles` to zero and enforce `ARC015` universally.

Risk if ignored: callers bind to adapter details, making infra changes high-risk and harder to evolve.

Effort: L

## Medium

### A1-ARCH-005: Layering enforcement has blind spots outside `app/domain/infra`
Problem: policy direction/purity checks do not cover non-standard subfolders that contain substantial runtime logic.

Evidence:
- `policy/config.json:188-189` (`core-layer-direction`) only includes `app/domain/infra` paths.
- `policy/config.json:137-138` (`core-layer-purity`) only includes `domain/app` paths.
- `src/core/target/app/index.ts:1-3` and `src/core/target/domain/index.ts:1-3` are placeholders.
- `src/core/target/click/target-click.ts:493` shows substantial target logic lives in `click/` (outside enforced layer globs).

Recommendation:
- Near-term: either migrate `click/effects/frames/snapshot/url` under `app/domain/infra`, or extend policy rules to include these folders explicitly.
- Longer-term: standardize one internal layering shape per bounded domain and enforce by rule (not convention).

Risk if ignored: architectural regressions can accumulate in unchecked directories while policy stays green.

Effort: M

### A1-ARCH-006: Network feature seams are mostly pass-through, not real layers
Problem: `commands/usecases/domain/infra` exist, but commands call core directly and inner layers are mostly re-export shells.

Evidence:
- `src/features/network/commands/network.ts:1` imports `../../../core/network/public.ts` directly.
- `src/features/network/usecases/index.ts:1-16` re-exports core network API.
- `src/features/network/infra/index.ts:1` re-exports from core.
- `src/features/network/domain/index.ts:1-18` only re-exports types from `src/core/network-types.ts`.
- `docs/agent-guidance-architecture.md:33` defines feature packages with `commands/usecases/domain/infra` entrypoints.

Recommendation:
- Near-term: move option normalization + command-specific orchestration into `features/network/usecases/*` and keep command modules as wiring.
- Longer-term: make network feature own its domain language (inputs/outputs), with core as implementation dependency behind a usecase port.

Risk if ignored: the feature boundary stays thin veneer; changes in core APIs ripple directly into surface command modules.

Effort: M

### A1-ARCH-007: Policy rule IDs are not unique (ARC011 collision)
Problem: two different rules share `ARC011`, making violation reporting ambiguous.

Evidence:
- `policy/rules/architecture/core-root-state-imports.mjs:47` sets `id: "ARC011"`.
- `policy/rules/architecture/core-providers-imports.mjs:51` also sets `id: "ARC011"`.
- `scripts/policy-check.mjs:166` prints only `[ruleId]`, so collisions lose rule identity in text output.

Recommendation:
- Near-term: assign a distinct ID to one rule and update docs that reference rule IDs.
- Longer-term: add a startup/assertion check in `policy/rules/index.mjs` that fails on duplicate `id` values.

Risk if ignored: automated triage and human debugging can misclassify violations.

Effort: S

### A1-ARCH-008: Release-required checks do not include strict architecture gate
Problem: release gating relies on baseline policy, while strict policy currently surfaces substantial architecture debt.

Evidence:
- `package.json:39` `validate` uses `policy:check`.
- `package.json:40` `validate:strict` exists but is separate.
- `docs/release-governance.md:29-33` required checks list does not include `validate:strict`.
- `docs/agent-guidance-architecture.md:27` calls out strict architecture gate (`pnpm -s validate:strict`).

Recommendation:
- Near-term: define an explicit rollout plan (for example, required on main after N violations are retired).
- Longer-term: make strict policy part of required release checks once target debt is burned down.

Risk if ignored: architecture constraints remain advisory for shipped changes.

Effort: M

## Low

### A1-ARCH-009: Architecture navigation doc has a stale deep-dive pointer
Problem: top-level architecture map points to a non-existent deep-dive filename.

Evidence:
- `ARCHITECTURE.md:42` references `docs/architecture/state-and-migrations.md`.
- `docs/architecture.md:25` points to `docs/architecture/state-and-versioning.md` (actual file).

Recommendation:
- Near-term: fix the pointer in `ARCHITECTURE.md`.
- Longer-term: add a doc link checker in CI for internal markdown links.

Risk if ignored: maintainers/agents can lose time following stale architecture navigation.

Effort: S

## Refactor Plan (Consolidated)

Near-term (1-2 PRs):
1. Decouple daemon domain/app from CLI helpers (`A1-ARCH-001`, `A1-ARCH-002`).
2. Resolve ARC011 ID collision and add a duplicate-ID guard (`A1-ARCH-007`).
3. Fix architecture doc pointer drift (`A1-ARCH-009`).

Longer-term (campaign):
1. Remove cross-domain internal allowlist and migrate to facade-only imports (`A1-ARCH-003`).
2. De-leak `public.ts` surfaces away from infra exports (`A1-ARCH-004`).
3. Align policy coverage with actual folder topology or migrate code into enforced layers (`A1-ARCH-005`).
4. Turn feature layering into real seams (network first) (`A1-ARCH-006`).
5. Promote strict policy into required release gates after staged debt retirement (`A1-ARCH-008`).

## Follow-up Round 1 (Additional Findings)

## High

### A1-ARCH-010: Command-path and daemon-bypass routing are hardcoded, not manifest-driven
Problem: ingress routing for daemon bypass and command-path parsing is maintained via hardcoded command names/arity, which can drift from the manifest-defined command surface.

Evidence:
- `src/cli.ts:103-110` hardcodes bypass only for `target network-tail` and `target console-tail`.
- `src/cli/options.ts:101-105` caps parsed command path to two tokens and hardcodes multi-token roots (`target`, `session`, `state`, `workspace`).
- `docs/architecture/features-and-commands.md:49-50` states manifests are authoritative.
- `src/core/types.ts:331-335` `CliCommandContract` has only `{id, usage, summary}` and no execution/routing traits (for example streaming/daemon mode hints).

Recommendation:
- Near-term: add explicit command traits (for example `executionMode: "daemon" | "direct"`) to contract/manifests and derive bypass logic from manifest metadata.
- Longer-term: replace ad-hoc argv path heuristics with manifest-backed command resolution for routing and diagnostics.

Risk if ignored: new streaming/nested commands can silently route through the wrong path or degrade diagnostics until manual routing code is updated.

Effort: M

### A1-ARCH-011: Surface-command purity rule has a structural loophole; runtime command root is a near-threshold monolith
Problem: command purity restrictions only apply to files under `/commands/`, but `register-commands.ts` at feature root can still host heavy command logic and Node IO.

Evidence:
- `policy/rules/surface-command-purity.mjs:30-33` marks command modules via `file.includes("/commands/")`.
- `policy/rules/surface-command-purity.mjs:48-49` enforces Node-import bans only when that condition is true.
- `src/features/runtime/register-commands.ts:1` imports `node:fs` and defines many command handlers directly (for example `.command("doctor")` at `:59`, `.command("open")` at `:166`, `.command("run")` at `:407`).
- `src/features/runtime/register-commands.ts:491` file length is 491 lines, close to the `max-loc` limit in `policy/config.json:272` (`500`).

Recommendation:
- Near-term: enforce `ARC005` on `register-commands.ts` files too, or move all command handlers into `features/*/commands/*` specs.
- Longer-term: split runtime feature into `commands -> usecases -> domain` seams with small registration glue files.

Risk if ignored: command-layer complexity can keep growing in unguarded root files and hit maintainability/LOC cliffs abruptly.

Effort: M

## Medium

### A1-ARCH-012: Daemon metadata parsing and ownership checks are duplicated in two infra modules
Problem: daemon metadata contract logic is implemented in parallel in client and worker modules instead of one shared boundary.

Evidence:
- `src/core/daemon/infra/daemon.ts:42-49` defines `DaemonMeta`; `:83-140` implements `parsePositiveInt/currentProcessUid/readDaemonMeta`; `:160-166` removes meta.
- `src/core/daemon/infra/worker.ts:22-29` defines a second `DaemonMeta`; `:35-90` re-implements `parsePositiveInt/currentProcessUid/readDaemonMeta`; `:92-98` removes meta.

Recommendation:
- Near-term: extract shared daemon metadata boundary helpers into one module (`infra/meta.ts`) used by both client and worker.
- Longer-term: define a typed metadata codec/schema with single-source validation + ownership enforcement.

Risk if ignored: schema or hardening updates can diverge across paths, causing inconsistent daemon lifecycle behavior.

Effort: S

### A1-ARCH-013: Baseline architecture budget thresholds are permissive enough to mask drift
Problem: baseline budget ceilings permit substantial structural deviation from intended architecture, reducing enforcement strength.

Evidence:
- `policy/config.json:297` allows up to `11` missing layered domains out of `12` bounded domains (`:281-294`).
- `policy/config.json:312` allows `21` core node-import budget violations.
- `policy/config.json:322` allows `6` process-env budget violations.
- strict profile sets all three to `0` (`policy/config.strict.json:252`, `:267`, `:277`).
- `docs/architecture/policy-and-layering.md:114-115` defines budgets as ratchets that should reduce drift.

Recommendation:
- Near-term: publish and execute a ratchet schedule in baseline config (for example reduce each threshold every release window).
- Longer-term: converge baseline and strict thresholds once active debt is retired.

Risk if ignored: policy may continue to pass while architecture drifts in ways only strict mode reveals.

Effort: M
