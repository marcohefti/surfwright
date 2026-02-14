# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
- [docs] Added release governance and contributor release-routing documentation.
- [ci] Added explicit docs-check, release-check, and dual-package-parity CI jobs.
- [npm] Added dual-package workspace manifests for `@marcohefti/surfwright` and `surfwright`.

### Changed
- [ci] Hardened CI workflows with concurrency, per-job timeouts, artifact uploads, and SHA-pinned actions.
- [contract] Release readiness checks now include dual-package parity validation and pack dry-run coverage.

### Fixed
- [docs] Enforced changelog/docs presence through `scripts/docs-check.mjs` wired into `pnpm validate`.

### Deprecated
- [docs] None.

### Removed
- [docs] None.

## [0.1.0] - 2026-02-13

### Added
- [cli] Initial pre-alpha release.
