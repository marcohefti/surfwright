# Skills Lifecycle

## Manifest and Lock Files

- manifest: `skills/surfwright/skill.json`
- lock: `skills/surfwright.lock.json`

Manifest gates (mandatory):

- `requires.surfwrightVersion`
- `requires.contractSchemaVersion`
- `requires.contractFingerprint`

Lock tracks installed/pinned digest and compatibility metadata.

## Commands

- `surfwright skill install`
- `surfwright skill doctor`
- `surfwright skill update`

Script compatibility wrapper:

- `scripts/install-skill.sh` forwards to `surfwright skill install`

## Safety Model

Install/update flow is atomic:

1. validate manifest
2. validate compatibility against runtime contract metadata
3. stage copy to temporary directory
4. atomic swap into destination
5. update lock + install metadata

If atomic swap fails, previous install state is restored.

## Validation

Repo validation enforces manifest + lock discipline:

- `pnpm skill:validate`
