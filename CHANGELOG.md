# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
- [open] Added `open --wait-until <commit|domcontentloaded|load|networkidle>` and additive output fields `waitUntil`, `reuseMode`, `reusedTarget` for explicit navigation/readiness evidence.
- [open] Added `open --reuse <off|url|origin|active>` for explicit tab-reuse policy (with `--reuse-url` preserved as compatibility alias).
- [target] Added `target style` for first-class computed-style inspection without `target eval` scripting.
- [target] Added `target click --proof` to emit a compact one-shot evidence payload (implies `--snapshot` + `--delta`).
- [target] Added additive `target click --proof.countAfter` for selector-mode clicks (post-action selector cardinality when available).
- [target] Added `target extract --include-actionable` with per-item actionable metadata (`handle`, `selectorHint`, `frameId`, `href`) for deterministic extract-to-action chaining.
- [target] Added `target extract --kind docs-commands` with command-oriented fields (`command`, `language`, `section`) for docs/codeblock extraction.
- [target] Added `--wait-timeout-ms <ms>` to `target click` and `target wait` so wait-stage budgets are explicit and independent from command timeout.
- [target] Added additive `target find` per-match metadata fields: `href` (nearest actionable anchor URL when present) and `tag` (matched element tag).
- [target] Added `target find` link-destination narrowing flags: `--href-host <host>` and `--href-path-prefix <prefix>` with echoed filter fields in the report.
- [target] Added additive `target click.handoff` metadata (`sameTarget`, `openedTargetId`, `openedUrl`, `openedTitle`) for deterministic post-click target chaining.
- [contract] Added additive `contract.guidance[]` with command signatures, runnable examples, and proof schema hints for high-traffic flows.
- [contract] Added `contract --compact` and `contract --search <term>` for low-token contract introspection and focused lookups.
- [cli] Added global `--output-shape <full|compact|proof>` (and `SURFWRIGHT_OUTPUT_SHAPE`) to project JSON outputs without changing command semantics.
- [target] Added `--proof` support to `target fill`, `target keypress`, `target upload`, `target drag-drop`, and `target dialog` with a shared compact evidence shape.
- [actions] Added post-action assertions (`--assert-url-prefix`, `--assert-selector`, `--assert-text`) and additive `proofEnvelope` support across `open`, `target click`, `target fill`, `target keypress`, `target upload`, `target drag-drop`, `target dialog`, `target download`, and `target wait`.
- [target] Added extraction kinds `headings`, `links`, `codeblocks`, `forms`, and `tables` to `target extract` for broader no-eval structured reads.
- [target] Added `target style --kind <button-primary|input-text|link-primary>` preset shortcuts for common style validation flows.
- [target] Added `target fill --event-mode <minimal|realistic|none>` and `target fill --events <csv>` for deterministic post-fill event dispatch (including keyup-sensitive UI flows).
- [target] Added `target click --within <selector>` to scope text/selector matching for dense pages and reduce ambiguous click selection.
- [target] Added `target extract --kind table-rows` with optional schema mapping (`--schema-json|--schema-file`) and deterministic record dedupe (`--dedupe-by`) to reduce `target eval` dependence.
- [open] Added additive navigation classification field `blockType` (`auth|captcha|consent|unknown`) to `open` reports.
- [target] Added additive `blockType` classification to `target url-assert` reports for auth/captcha/consent-aware URL assertions.

### Changed
- [target] `target click` wait payload now includes bounded telemetry (`timeoutMs`, `elapsedMs`, `satisfied`) for post-click wait stages.
- [target] `target wait` now includes a structured `wait` payload (`mode`, `value`, `timeoutMs`, `elapsedMs`, `satisfied`) while keeping existing top-level `mode`/`value`.
- [target] `target snapshot --mode orient|snapshot` now includes additive aggregate counters (`headingsCount`, `buttonsCount`, `linksCount`), plus `navCount` for orient mode.
- [errors] Typed failures can now include optional bounded `hints` and `hintContext` fields (additive; `code` + `message` contract preserved).
- [cli] Improved first-run discoverability: parse errors now show stronger suggestions/help and `target --target/--target-id` aliases rewrite to positional `targetId` where applicable.
- [target] Unified post-action waits across interactive actions: `target fill|keypress|upload|drag-drop|dialog` now support `--wait-for-text|--wait-for-selector|--wait-network-idle` and `--wait-timeout-ms`.
- [session] Reduced repeat command overhead in tight loops with short-lived CDP reachability caching during session health checks.
- [session] `session attach --cdp` now accepts `ws://`/`wss://` endpoints and supports HTTP(S) discovery URLs with path/query (resolved to websocket endpoints for runtime attach).
- [session] CDP attach health checks now split discovery and websocket-connect stages for clearer remote endpoint handling under variable latency.
- [browser] Managed Chrome launch now applies Linux container resilience flag `--disable-dev-shm-usage` to reduce startup flakes in constrained environments.
- [target] `target download` payload now includes first-class download proof fields: `downloadStarted`, `sourceUrl`, `fileName`, `bytes`, and `mime` (legacy `filename`/`size` retained).
- [errors] `target click` mismatch failures now include stronger disambiguation context (`withinSelector`, bounded candidate sample) for faster recovery without blind retries.

### Fixed
- [target] `target click` query-mismatch failures now return bounded remediation hints and context for `E_QUERY_INVALID` paths to reduce blind retry loops.
- [errors] `E_BROWSER_START_FAILED`, `E_BROWSER_START_TIMEOUT`, `E_STATE_LOCK_IO`, and `E_STATE_LOCK_TIMEOUT` now include bounded hints/hintContext for faster operator triage.
- [target] Stale `targetId` errors now include stronger replacement-target hints and hint context to speed recovery in concurrent session flows.
- [cli] Commander parse failures now map to typed JSON `E_QUERY_INVALID` responses (with bounded hints/hintContext) in JSON mode.
- [target] `target eval` timeout handling now performs best-effort CDP termination/stop-loading recovery so follow-up commands remain stable after `E_EVAL_TIMEOUT`.
- [session] `session attach` unreachable failures now redact sensitive CDP query credentials in error text.

### Deprecated
- None.

### Removed
- [docs] Removed campaign planning docs under `docs/campaigns/`.

## [0.1.2] - 2026-02-17


### Added
- [distribution] Added generated `skills-dist` branch and `skills-v*` tags for lightweight, pinned installs via the `skills` CLI (skills.sh ecosystem).
- [release] Added `publish-dry-run.yml` to exercise publish-path checks before tag-based release.
- [test] Added coverage for `scripts/release/release-notes-from-changelog.mjs` failure/success behavior.
- [workspace] Added `workspace init` and `workspace info` for a project-local `./.surfwright/` workspace (gitignored) that stores reusable browser profiles.
- [workspace] Added `workspace profile-locks` and `workspace profile-lock-clear` for introspecting and cleaning up stale profile locks.
- [auth] Added `open --profile <name>` and `run --profile <name>` to reuse a named workspace profile (persistent login state across agents).
- [cli] Added global `--workspace <dir>` (and `SURFWRIGHT_WORKSPACE_DIR`) to override workspace resolution.
- [session] Added `--browser-mode <headless|headed>` to managed session flows (`session ensure/new/fresh`, `open`, `run`) for headed/headless control (defaults unchanged).
- [contract] Added `browserMode` reporting to `open`/`session` JSON outputs (`unknown` for attached sessions).
- [open] Added redirect evidence fields to `open` output: `requestedUrl`, `finalUrl`, `wasRedirected`, optional `redirectChain` + `redirectChainTruncated` (keeps `url` as final for back-compat).
- [open] Added first-class download capture via `open --allow-download` (saves to an artifacts dir and reports deterministic download metadata instead of `ERR_ABORTED`).
- [target] Added `target url-assert` for typed URL drift guards (`--host`, `--origin`, `--path-prefix`, `--url-prefix`).
- [target] Added `target frames` for bounded frame enumeration with stable `frameId` handles.
- [target] Added `target eval --expr <js>` (value-expression mode), `--frame-id <id>`, and compact `context` metadata in eval output.
- [target] Added `target click --index <n>` (0-based) and selection evidence (`matchCount`, `pickedIndex`) for deterministic multi-match actions.
- [target] Added `target click --explain` for bounded match selection/rejection diagnostics without clicking.
- [target] Added `target click --delta` for bounded evidence-based before/after change capture (URL/title, focus evidence, role counts, and clicked-element ARIA attribute values; no semantic UI claims).
- [target] Added `target snapshot --mode <snapshot|orient>` for quiet first-load orientation payloads (`orient` returns `h1` and scopes `links` to header/nav links).
- [target] Added `target snapshot --mode a11y` for bounded accessibility-tree rows (`a11y.rows`) with optional element `handle` values and paging via `ax=<n>` cursor tokens (`--max-ax-rows <n>`).
- [target] Added `target snapshot` paging via `--cursor <token>` and `nextCursor` in the report.
- [target] Added `target snapshot --include-selector-hints` returning bounded `items` rows with `selectorHint`.
- [target] Added `target snapshot-diff` for high-signal diffs between two saved snapshot reports.
- [target] Added `target count` for fast, bounded element counts (`--selector`/`--text`, optional `--visible-only`, optional `--frame-scope`).
- [target] Added `target download` for deterministic download capture (filename, sha256, size, headers/status when available) into an artifacts dir.
- [target] Added `--frame-scope <main|all>` to `target find/click/fill/spawn/wait` for deterministic cross-iframe queries/actions.
- [target] Added `target click --handle <handle>` to click an element handle returned by `target snapshot --mode a11y`.
- [network] Added `target network-around` to capture `network-begin` + click + `network-end` in one deterministic command.
- [network] Added per-capture sampling/redaction controls: `--body-sample-bytes` (bounded) and repeated `--redact-regex` (with safe defaults for sensitive header redaction when headers are included).
- [run] Added replayable evidence logs via `run --log-ndjson <path>` and `--log-mode <minimal|full>` (append-only NDJSON run log).

### Changed
- [release] Publish and release-draft workflows now use shared smoke script `scripts/release/smoke-contract.mjs`.
- [release] `release-check` now fails when `CHANGELOG.md` is missing the current package version section.
- [docs] `changelog-check` now enforces only the `Unreleased` skeleton buckets (with list items).
- [contract] `session list` now includes `browserMode` per session row.
- [contract] `open` and `session` JSON outputs now include `profile` when a workspace profile is in use.
- [cli] JSON output is now the default for all commands; use `--no-json` for human-friendly summaries and `--pretty` for multiline JSON.
- [docs] Documented headed/headless defaults and a minimal human login handoff recipe (README + skill).
- [target] `target snapshot` now accepts `0` for `--max-chars`, `--max-headings`, `--max-buttons`, and `--max-links` to omit categories.
- [target] `target extract --kind blog/news/docs/generic` DOM presets now prioritize semantic tags/ARIA roles over site-shaped class selectors.
- [target] `target eval --script-file` now supports `--mode expr` to align return-value semantics with `--expr` (expression vs program).
- [network] Network capture reports now include explicit `limits.bodySampleBytes` and `redaction` metadata for safe evidence storage.
- [skill] Bumped `skills/surfwright` to `skillVersion=0.1.2` and refreshed lock metadata for the updated runtime contract fingerprint.

### Fixed
- [release] Removed drift-prone duplicate smoke command logic across release workflows.
- [daemon] `skill *` commands now bypass the daemon so relative `--source`/`--lock` paths resolve from the operator's current working directory (not a long-lived worker cwd).
- [target] Fixed DOM evaluation on some OOPIF-heavy pages (e.g. Substack custom domains) where Playwright `evaluate()` could bind to a hidden tracking iframe realm; `target eval/read/snapshot/extract/frames/health/screenshot` now execute DOM reads via CDP in an isolated world anchored to the selected frame.
- [target] Fixed `target find/click/fill/spawn/wait --for-text/--for-selector` on OOPIF-heavy pages by moving element queries/actions onto the same CDP isolated-world evaluator surface (avoids Playwright realm binding issues on reattached sessions).
- [target] Fixed `target spawn` on pages where programmatic `element.click()` does not open a new tab (uses a trusted mouse click instead).
- [target] Fixed `target eval` failing when an expression triggers navigation while persisting state (best-effort title capture).
- [target] Fixed intermittent `target click`/`target snapshot` follow-up reads failing after navigation by retrying CDP evaluations when cached execution contexts are invalidated.
- [network] Hardened `target network-begin` capture correctness by waiting for listener readiness before returning the `captureId`.
- [test] Browser contract tests now run with a default per-test timeout and abort-safe temp-root cleanup to prevent leaked Chrome processes.
- [test] Browser contract tests no longer depend on external websites (use local fixtures and local HTTP servers).

### Deprecated
- [docs] None.

### Removed
- [dev] Removed the in-repo ZeroContext Lab (ZCL) harness implementation; ZeroContext workflows remain documented, but ZCL is now treated as an external tool.

## [0.1.1] - 2026-02-14

### Added
- [docs] Added release governance and contributor release-routing documentation.
- [ci] Added explicit changelog-check, release-check, and dual-package-parity CI jobs.
- [npm] Added dual-package workspace manifests for `@marcohefti/surfwright` and `surfwright`.
- [distribution] Added Homebrew tap sync workflow and deferred winget scaffold/backlog tracking.

### Changed
- [ci] Hardened CI workflows with concurrency, per-job timeouts, artifact uploads, and SHA-pinned actions.
- [contract] Release readiness checks now include dual-package parity validation and pack dry-run coverage.
- [release] Publish workflow now supports idempotent dual-package recovery runs and verifies npm provenance attestations for both package names.
- [release] Post-publish smoke checks now install package binaries in isolated temp dirs for deterministic verification.
- [docs] README install matrix now includes active Homebrew tap install/upgrade commands.

### Fixed
- [docs] Enforced changelog presence through `scripts/changelog-check.mjs` wired into `pnpm validate`.
- [release] Publish workflow smoke command resolution failures no longer block successful release verification.

## [0.1.0] - 2026-02-13

### Added
- [cli] Initial pre-alpha release.
