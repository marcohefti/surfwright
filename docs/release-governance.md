# Release Governance

## Source of Truth

This document is authoritative for release, publish, update, compatibility, and required-check policy.
If implementation diverges from this document, update implementation and docs in the same change set.

## Locked Policies

- Canonical npm package: `@marcohefti/surfwright`
- Guard/discoverability package: `surfwright`
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
- `docs-check`
- `release-check`
- `dual-package-parity-check`

When adding new release-critical jobs, update this list and repository rulesets in the same change set.

## Update/Skill Governance

- `surfwright update *` and `surfwright skill *` are authoritative runtime interfaces.
- Repo scripts may wrap runtime interfaces but cannot redefine policy.
- No silent auto-update is allowed by default in agent/operator environments.
- Any auto-update mode must be explicit, documented, and compatibility-gated.

## Rollback Governance

- Every release must maintain a rollback path.
- Rollback must cover both package names and dist-tags together.
- Known-bad versions must be deprecatable without destructive unpublish flows.

## Solo-Maintainer Mode

Until a second maintainer is active:

- `main` remains the only active branch.
- `release` environment stays non-blocking (no required reviewers).
- Approval gates stay minimal and automation-centric.

When maintainer count increases, revisit environment and ruleset approval gates.
