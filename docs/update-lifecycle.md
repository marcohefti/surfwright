# Update Lifecycle

## Commands

- `surfwright update check`
- `surfwright update run`
- `surfwright update rollback`

All commands support `--json` output for deterministic machine parsing.

## Channels and Dist-Tags

- `stable` -> `latest`
- `beta` -> `next`
- `dev` -> `dev` (reserved until enabled)

## Policy Model

- `manual`: never auto-apply, report availability only.
- `pinned`: only allow target version that matches configured pin.
- `safe-patch`: allow patch-line updates only.

Defaults are read from `~/.surfwright/config.json` (`update.checkOnStart`, `update.channel`, `update.policy`, `update.pinnedVersion`).

## Preflight and Safety

`update run` preflight includes:

1. metadata fetch for channel/dist-tag target
2. policy gate checks
3. source-install preconditions for git checkouts (clean tree + `main` branch)

Apply flow requires post-update health verification via `surfwright doctor`.
On health-check failure, rollback is attempted automatically.

## Rollback

- automatic rollback on failed post-update doctor
- explicit rollback via `surfwright update rollback`
- update history stored under `~/.surfwright/updates/history.json`
