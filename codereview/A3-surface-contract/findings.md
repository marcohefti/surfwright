# A3 Surface/Contract Review Findings

Scope reviewed: CLI command surface, contract stability, manifest wiring, output consistency, typed errors, docs/contract drift.
Method: source inspection + targeted runtime probes (`node dist/cli.js ...`).

## F-001 (high) - `extension.*` ignores `--no-json`
- Category: output consistency
- Problem: extension commands always emit JSON, even when global `--no-json` is set.
- Evidence:
  - `src/features/extensions/register-commands.ts:11-18` prints JSON in both branches.
  - Global flag semantics say `--no-json` disables JSON: `src/cli.ts:148-150`.
  - Manifest advertises `--no-json` for extension commands: `src/features/extensions/manifest.ts:6`, `src/features/extensions/manifest.ts:11`, `src/features/extensions/manifest.ts:16`, `src/features/extensions/manifest.ts:21`.
  - Runtime probe: `node dist/cli.js --no-json extension list` returned JSON payload, not human summary.
- Recommendation: either honor `--no-json` in `extension.*` printers or remove `--no-json` from extension command surface and docs/contract in one change window.
- Risk if ignored: inconsistent operator/agent expectations; parser branches needed only for extension family.
- Effort: small.

## F-002 (medium) - `contract` accepts `--compact` but contract schema hides it
- Category: contract stability
- Problem: runtime accepts `--compact` while per-command contract flags omit it.
- Evidence:
  - `src/features/runtime/register-commands.ts:76` adds `--compact`.
  - `src/features/runtime/register-commands.ts:88-89` documents it as retained alias.
  - `src/features/runtime/manifest.ts:11` usage omits `--compact`.
  - `src/core/cli-contract.ts:175` derives command flags from manifest usage.
  - Runtime probes:
    - `node dist/cli.js contract --compact` succeeds.
    - `node dist/cli.js contract --command contract` returns `flags` without `--compact`.
- Recommendation: remove `--compact` (clean-slate) or add explicit alias metadata to contract output and tests.
- Risk if ignored: contract-first discovery is incomplete; agents may reject valid invocations.
- Effort: small.

## F-003 (high) - command-path parsing truncates/whitelists paths, degrading typed diagnostics
- Category: typed error handling
- Problem: parser only supports two path segments and only some roots, so diagnostics lose `validFlags`/`canonicalInvocation` for multiple command families.
- Evidence:
  - `src/cli/options.ts:101-106` caps path depth at 2 and only permits second segment for `target|session|state|workspace`.
  - `src/core/cli-contract.ts:37-40` maps only first 1-2 segments to contract id.
  - `src/cli/commander-failure.ts:24-31` depends on resolved contract to populate diagnostics.
  - Affected commands exist in manifests:
    - `extension.list`: `src/features/extensions/manifest.ts:11`
    - `update.check`: `src/features/runtime/manifest.ts:108`
    - `target.trace.insight`: `src/features/network/manifest.ts:70`
  - Runtime probes:
    - `node dist/cli.js extension list --bogus` => `hintContext.commandPath:"extension"`, no `diagnostics.validFlags`.
    - `node dist/cli.js update check --bogus` => `hintContext.commandPath:"update"`, no `diagnostics.validFlags`.
    - `node dist/cli.js target trace insight --bogus` => `hintContext.commandPath:"target trace"`, no `diagnostics.validFlags`.
    - Control: `node dist/cli.js session list --bogus` includes `validFlags` and `canonicalInvocation`.
- Recommendation: derive command path from Commander parse context or a manifest trie with full depth/all roots.
- Risk if ignored: weaker machine-recoverable failures and lower operator UX on invalid input.
- Effort: medium.

## F-004 (medium) - hidden argv rewrites create uncontracted CLI grammar
- Category: docs/contract drift risk
- Problem: compatibility rewrites accept inputs not represented in manifest usage or contract output.
- Evidence:
  - Legacy target alias rewrite: `src/cli/argv-normalize.ts:118-208` (`--target` -> positional).
  - Session clear compatibility rewrite: `src/cli/argv-normalize.ts:211-337` (`--no-prompt`, `--keep-processes=<bool>`, positional scope).
  - Dot alias rewrite: `src/cli/argv-normalize.ts:340-380`.
  - Manifest usage omits those forms:
    - `target.snapshot`: `src/features/target-core/manifest.ts:19`
    - `session.clear`: `src/features/runtime/manifest.ts:74`
  - Contract policy states contract-first discovery and manifest truthfulness: `docs/architecture/contract-system.md:26-30`, `docs/architecture/contract-system.md:70-72`.
  - Tests lock these compatibility paths as accepted behavior:
    - `test/cli.contract.test.mjs:153-167`
    - `test/dot-alias.contract.test.mjs:62-68`
- Recommendation: either remove rewrites (clean-slate) or expose compatibility aliases explicitly in contract payload + docs.
- Risk if ignored: persistent hidden surface area and higher drift/regression probability.
- Effort: medium.

## F-005 (medium) - daemon typed failures drop `retryable`
- Category: typed error handling
- Problem: queue-pressure daemon failures are surfaced without `retryable`, despite error contract marking them retryable.
- Evidence:
  - Error contract marks queue failures retryable: `src/core/contracts/error-contracts.ts:39-40`.
  - Daemon response error schema is only `code` + `message`: `src/core/daemon/infra/daemon-transport.ts:37-40`.
  - Daemon client outcome forwards only `code` + `message`: `src/core/daemon/infra/daemon.ts:416-420`.
  - CLI prints only `ok/code/message` for daemon typed errors: `src/cli.ts:280-285`.
  - Queue-routing tests assert only code, not retryability: `test/daemon/daemon.queue-routing.contract.test.mjs:164`, `test/daemon/daemon.queue-routing.contract.test.mjs:193`.
- Recommendation: include `retryable` in daemon error envelope or map retryability from `errorContracts` before printing.
- Risk if ignored: agents cannot reliably auto-retry transient daemon-queue failures.
- Effort: medium.

## F-006 (medium) - contract snapshot gate does not guard error-message drift
- Category: docs/contract drift risk
- Problem: message text in typed errors can change without failing contract fingerprint/snapshot checks.
- Evidence:
  - Canonical error list includes `message`: `src/core/contracts/error-contracts.ts:3-70`.
  - Fingerprint input excludes message (`code`, `retryable` only): `src/core/cli-contract.ts:355-357`.
  - Snapshot normalizer excludes message (`code`, `retryable` only): `scripts/checks/contract-snapshot.mjs:80-86`.
  - Contract tests only assert error codes from fixture: `test/commands.contract.test.mjs:61-64`.
- Recommendation: if messages are contractual, include them in fingerprint/snapshot/tests; if not, document non-contractual status explicitly.
- Risk if ignored: operator/agent remediation text may drift silently without governance signal.
- Effort: small to medium.

## F-007 (low) - commander parse failures produce dual-channel output (stderr + JSON)
- Category: output consistency
- Problem: invalid CLI input emits both Commander human stderr and typed JSON failure envelope.
- Evidence:
  - Commander error UX enabled globally: `src/cli.ts:157-159`.
  - JSON failure emitted in catch path: `src/cli.ts:189-193`.
  - Runtime probe `node dist/cli.js target snapshot` produced stderr human error plus stdout JSON failure.
- Recommendation: suppress commander stderr when JSON mode is active, keep current behavior for `--no-json`.
- Risk if ignored: wrappers that merge streams lose strict machine-parsable output.
- Effort: medium.

## F-008 (high) - daemon can emit error codes outside published contract error set
- Category: contract stability
- Problem: CLI can surface daemon internal codes (`E_DAEMON_TOKEN_INVALID`, `E_DAEMON_REQUEST_INVALID`, `E_DAEMON_RUN_FAILED`) that are not present in `contract.errors`.
- Evidence:
  - Daemon worker emits internal typed codes:
    - `E_DAEMON_REQUEST_INVALID`: `src/core/daemon/app/worker-request-orchestrator.ts:64`, `src/core/daemon/app/worker-request-orchestrator.ts:124`, `src/core/daemon/app/worker-request-orchestrator.ts:173`
    - `E_DAEMON_TOKEN_INVALID`: `src/core/daemon/app/worker-request-orchestrator.ts:89`
    - `E_DAEMON_RUN_FAILED`: `src/core/daemon/app/worker-request-orchestrator.ts:161`, `src/core/daemon/infra/worker.ts:420`
  - CLI forwards daemon typed errors directly: `src/core/daemon/infra/daemon.ts:417-420`, `src/cli.ts:279-285`.
  - Published contract error list does not include those daemon-internal codes (`src/core/contracts/error-contracts.ts:3-70`).
  - Runtime probe with stub daemon returned CLI payload `{code:"E_DAEMON_TOKEN_INVALID"}` for `session list`.
- Recommendation: decide one contract boundary and enforce it: either map daemon-internal failures to published surface codes before CLI emission, or add documented daemon transport codes to `errorContracts` and docs/tests.
- Risk if ignored: contract-first agents cannot rely on `contract.errors` as complete failure taxonomy.
- Effort: medium.

## F-009 (high) - invalid CLI input is misclassified as `E_INTERNAL`
- Category: typed error handling
- Problem: user input validation errors thrown as `Error` are mapped to `E_INTERNAL` instead of input/usage failure class.
- Evidence:
  - Parsers throw plain `Error`:
    - timeout parser: `src/cli.ts:58-67`
    - lease TTL parser: `src/features/runtime/register-commands.ts:48-53`
  - Generic `Error` maps to `E_INTERNAL`: `src/core/errors.ts:107-113`.
  - Those parsers are wired to user flags (`--timeout-ms`, `--lease-ttl-ms`): `src/features/runtime/register-commands.ts:247`, `src/features/runtime/register-commands.ts:268`.
  - Runtime probes:
    - `node dist/cli.js session ensure --timeout-ms abc` => `{"code":"E_INTERNAL","message":"timeout-ms must be a positive integer"}`
    - `node dist/cli.js session new --lease-ttl-ms foo` => `{"code":"E_INTERNAL","message":"lease-ttl-ms must be a positive integer"}`
- Recommendation: convert parse callbacks to throw `CliError("E_QUERY_INVALID", ...)` (or wrap parse exceptions at command boundary) so invalid user input remains a typed query/usage failure.
- Risk if ignored: retry/router logic treats operator mistakes as internal runtime failures; triage signal quality degrades.
- Effort: small.

## F-010 (medium) - command/error ordering in compact contract is not governance-pinned
- Category: contract governance
- Problem: compact `commandIds`/`errorCodes` ordering is not protected by fingerprint or snapshot checks.
- Evidence:
  - Compact output emits current manifest order (`src/features/runtime/contract-output.ts:99-100`).
  - Manifest aggregation order comes from plugin/manifest declaration order (`src/features/registry.ts:99-101`).
  - Fingerprint intentionally sorts commands/errors before hashing (`src/core/cli-contract.ts:352-357`).
  - Snapshot check also sorts commands/errors before compare (`scripts/checks/contract-snapshot.mjs:70-87`).
- Recommendation: either declare list ordering non-contractual in docs, or sort `commandIds`/`errorCodes` in compact output and add explicit order assertions.
- Risk if ignored: reorder-only refactors can silently change compact output token stream without tripping release gates.
- Effort: small.
