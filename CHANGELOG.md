# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
- [docs] None.

### Changed
- [docs] None.

### Fixed
- [docs] None.

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
