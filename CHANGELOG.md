# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
- [release] Added `publish-dry-run.yml` to exercise publish-path checks before tag-based release.
- [test] Added coverage for `scripts/release/release-notes-from-changelog.mjs` failure/success behavior.
- [session] Added `--browser-mode <headless|headed>` to managed session flows (`session ensure/new/fresh`, `open`, `run`) for headed/headless control (defaults unchanged).
- [contract] Added `browserMode` reporting to `open`/`session` JSON outputs (`unknown` for attached sessions).
- [open] Added redirect evidence fields to `open` output: `requestedUrl`, `finalUrl`, `wasRedirected`, optional `redirectChain` + `redirectChainTruncated` (keeps `url` as final for back-compat).
- [target] Added `target url-assert` for typed URL drift guards (`--host`, `--origin`, `--path-prefix`, `--url-prefix`).
- [target] Added `target frames` for bounded frame enumeration with stable `frameId` handles.
- [target] Added `target eval --expr <js>` (value-expression mode), `--frame-id <id>`, and compact `context` metadata in eval output.
- [target] Added `target click --index <n>` (0-based) and selection evidence (`matchCount`, `pickedIndex`) for deterministic multi-match actions.
- [target] Added `target click --explain` for bounded match selection/rejection diagnostics without clicking.

### Changed
- [release] Publish and release-draft workflows now use shared smoke script `scripts/release/smoke-contract.mjs`.
- [release] `release-check` now fails when `CHANGELOG.md` is missing the current package version section.
- [docs] `docs-check` now enforces full `Unreleased` skeleton buckets with list items.
- [contract] `session list` now includes `browserMode` per session row.
- [docs] Documented headed/headless defaults and a minimal human login handoff recipe (README + skill).

### Fixed
- [release] Removed drift-prone duplicate smoke command logic across release workflows.

### Deprecated
- [docs] None.

### Removed
- [docs] None.

## [0.1.1] - 2026-02-14

### Added
- [docs] Added release governance and contributor release-routing documentation.
- [ci] Added explicit docs-check, release-check, and dual-package-parity CI jobs.
- [npm] Added dual-package workspace manifests for `@marcohefti/surfwright` and `surfwright`.
- [distribution] Added Homebrew tap sync workflow and deferred winget scaffold/backlog tracking.

### Changed
- [ci] Hardened CI workflows with concurrency, per-job timeouts, artifact uploads, and SHA-pinned actions.
- [contract] Release readiness checks now include dual-package parity validation and pack dry-run coverage.
- [release] Publish workflow now supports idempotent dual-package recovery runs and verifies npm provenance attestations for both package names.
- [release] Post-publish smoke checks now install package binaries in isolated temp dirs for deterministic verification.
- [docs] README install matrix now includes active Homebrew tap install/upgrade commands.

### Fixed
- [docs] Enforced changelog/docs presence through `scripts/docs-check.mjs` wired into `pnpm validate`.
- [release] Publish workflow smoke command resolution failures no longer block successful release verification.

## [0.1.0] - 2026-02-13

### Added
- [cli] Initial pre-alpha release.
