# Release Governance

## Source of Truth

This document is authoritative for release, publish, update, compatibility, and required-check policy.
If implementation diverges from this document, update implementation and docs in the same change set.

## Locked Policies

- Canonical npm package: `@marcohefti/surfwright`
- Guard/discoverability package: `surfwright`
- skills.sh lightweight ref: `marcohefti/surfwright@skills-dist`
- skills.sh pinned tags: `skills-vX.Y.Z` (repo tags, not GitHub releases)
- License: `MIT`
- Runtime Node policy: `>=22.14.0`
- Primary dev/CI target: Node 24
- CI matrix floor: Node 22 + Node 24
- Update default policy: `manual` for operator/local flows
- CI/production-agent policy: `pinned`
- Dist-tags: `latest` for stable, `next` for prerelease
- Release trigger: tag-driven on `v*`
- Publish gate: CI is the only publish path
- Skills compatibility gates: `requires.surfwrightVersion`, `contractSchemaVersion`, `contractFingerprint`

## Required CI Check Contract

Current required release-critical checks:

- `validate`
- `test`
- `changelog-check`
- `release-check`
- `dual-package-parity-check`

When adding new release-critical jobs, update this list and repository rulesets in the same change set.

## Branch Protection (Non-Optional)

Release governance assumes `main` cannot advance without the required checks passing.

Repository rulesets must enforce:

- required status checks on `main` (the list above)
- no direct pushes to `main` (PR-only)
- no bypassing required checks (including admins)

## Pre-Tag Dry-Run Policy

Before cutting a new `v*` tag, run `publish-dry-run.yml` with the target version.
This workflow must pass release-check, parity checks, local dual-package smoke checks, and versioned changelog release-notes generation.

## Update/Skill Governance

- `surfwright update *` and `surfwright skill *` are authoritative runtime interfaces.
- Repo scripts may wrap runtime interfaces but cannot redefine policy.
- No silent auto-update is allowed by default in agent/operator environments.
- Any auto-update mode must be explicit, documented, and compatibility-gated.

## Rollback Governance

- Every release must maintain a rollback path.
- Rollback must cover both package names and dist-tags together.
- Known-bad versions must be deprecatable without destructive unpublish flows.
- Provenance attestations must exist for both package names on every successful publish.

## Dual-Package Deprecation + Rollback Procedure

1. Restore dist-tags for both packages together:
   - `npm dist-tag add @marcohefti/surfwright@<good> <dist-tag>`
   - `npm dist-tag add surfwright@<good> <dist-tag>`
2. Deprecate known-bad versions for both package names together:
   - `npm deprecate @marcohefti/surfwright@<bad> "<message>"`
   - `npm deprecate surfwright@<bad> "<message>"`
3. Smoke-check both names with contract output:
   - `npx -y @marcohefti/surfwright@<good> contract`
   - `npx -y surfwright@<good> contract`
4. Capture rollback metadata artifact from workflow execution.

## Deferred Distribution Backlog

### skills.sh Listing (Enabled)

Notes:

- skills.sh listing is driven by anonymous telemetry from the `skills` CLI (not by an explicit publish step).
- SurfWright maintains a generated `skills-dist` branch and `skills-v*` tags so installs are fast and reproducible.

### Homebrew Core (Deferred)

Keep SurfWright in `marcohefti/homebrew-tap` until all are true:

- stable release cadence with low churn
- enough external demand to justify Homebrew/core maintenance overhead
- repeated successful auto-bump + install/test runs in tap CI

### winget Enablement Checklist (Deferred)

- define Windows artifact format (`zip` vs `msi`)
- define Windows signing workflow and certificate ownership
- generate winget manifests deterministically per release
- automate PR creation to `microsoft/winget-pkgs`
- monitor and reconcile moderation feedback

### Chocolatey / apt (Deferred)

Defer until measured demand justifies additional maintenance burden.

## Solo-Maintainer Mode

Until a second maintainer is active:

- `main` remains the only active branch.
- `release` environment stays non-blocking (no required reviewers).
- Approval gates stay minimal and automation-centric.

When maintainer count increases, revisit environment and ruleset approval gates.
