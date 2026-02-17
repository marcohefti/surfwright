# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
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
- [target] Added `target snapshot` paging via `--cursor <token>` and `nextCursor` in the report.
- [target] Added `target snapshot --include-selector-hints` returning bounded `items` rows with `selectorHint`.
- [target] Added `target snapshot-diff` for high-signal diffs between two saved snapshot reports.
- [target] Added `target count` for fast, bounded element counts (`--selector`/`--text`, optional `--visible-only`, optional `--frame-scope`).
- [target] Added `target download` for deterministic download capture (filename, sha256, size, headers/status when available) into an artifacts dir.
- [target] Added `--frame-scope <main|all>` to `target find/click/fill/spawn/wait` for deterministic cross-iframe queries/actions.
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
- [skill] Bumped `skills/surfwright` to `skillVersion=0.1.1` and refreshed lock metadata for the updated runtime contract fingerprint.

### Fixed
- [release] Removed drift-prone duplicate smoke command logic across release workflows.
- [daemon] `skill *` commands now bypass the daemon so relative `--source`/`--lock` paths resolve from the operator's current working directory (not a long-lived worker cwd).
- [target] Fixed DOM evaluation on some OOPIF-heavy pages (e.g. Substack custom domains) where Playwright `evaluate()` could bind to a hidden tracking iframe realm; `target eval/read/snapshot/extract/frames/health/screenshot` now execute DOM reads via CDP in an isolated world anchored to the selected frame.
- [target] Fixed `target find/click/fill/spawn/wait --for-text/--for-selector` on OOPIF-heavy pages by moving element queries/actions onto the same CDP isolated-world evaluator surface (avoids Playwright realm binding issues on reattached sessions).
- [target] Fixed `target eval` failing when an expression triggers navigation while persisting state (best-effort title capture).
- [network] Hardened `target network-begin` capture correctness by waiting for listener readiness before returning the `captureId`.

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
