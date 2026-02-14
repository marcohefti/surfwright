# Contributor Release Routing

## Goal

Make required release/docs/changelog updates obvious for every behavior change.

## Routing Matrix

| Change type | Required updates |
|---|---|
| CLI behavior/flags/output changes | `CHANGELOG.md`, `README.md`, relevant command docs, tests/fixtures |
| Release/publish/update policy changes | `docs/release-governance.md`, `CHANGELOG.md`, `AGENTS.md` routing if needed |
| CI release-gate changes | `.github/workflows/*.yml`, `docs/release-governance.md`, `CHANGELOG.md` |
| Skills compatibility/lifecycle changes | `skills/surfwright/*`, `README.md` skill docs, `docs/release-governance.md`, `CHANGELOG.md` |
| Maintainer process changes | `docs/contributor-release-routing.md`, `AGENTS.md`, `CHANGELOG.md` |

## Mandatory Checklist (Per Change)

1. Update `CHANGELOG.md` under `## [Unreleased]` for each user-visible delta.
2. Update `README.md` when install/update behavior, availability, or command UX changes.
3. Update `docs/release-governance.md` when policy, checks, tags, channels, or compatibility gates change.
4. Update `AGENTS.md` when Start Here or routing boundaries change.
5. Run:
   - `pnpm validate`
   - `pnpm test`
   - `pnpm skill:validate`

## Definition of Done

A change is not done until behavior, governance docs, and changelog entries agree.
