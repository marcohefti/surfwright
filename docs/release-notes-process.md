# Release Notes Process

## Inputs

- `CHANGELOG.md` (`## [Unreleased]`)
- Contract snapshot (`test/fixtures/contract/contract.snapshot.json`)
- CI evidence (`validate`, `test`, `docs-check`, `release-check`, `dual-package-parity-check`)
- Release metadata artifact (publish/release workflows)

## Release Cut Checklist

1. Validate release candidates:
   - `pnpm validate`
   - `pnpm test`
   - `pnpm skill:validate`
2. Confirm changelog quality:
   - every user-visible change is listed
   - breaking deltas include migration action
3. Move `Unreleased` entries into `## [x.y.z] - YYYY-MM-DD`.
4. Recreate empty `Unreleased` skeleton.
5. Generate release notes using the template below.
6. Release automation requires the explicit `## [x.y.z]` changelog section; publish/draft fail if it is missing.

## Release Notes Template

### SurfWright vX.Y.Z - YYYY-MM-DD

#### Highlights
- ...

#### Availability Changes
| Surface | Previous | New | Action Required |
|---|---|---|---|
| ... | ... | ... | yes/no |

#### Breaking Changes
- [breaking][scope] ... Migration: ...

#### Agent Impact
- ...

#### Operator Impact
- ...

#### Verification
- `pnpm validate`: pass/fail
- `pnpm test`: pass/fail
- `pnpm skill:validate`: pass/fail
- `surfwright --json contract`: captured
