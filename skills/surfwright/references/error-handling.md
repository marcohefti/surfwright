# Error Handling

## Contract-First Rule

Always branch on runtime contract data, not stale docs:

```bash
surfwright contract --full --search E_ | jq '.errors[] | {code,retryable,message}'
```

## Branch Policy

- Non-zero exit is always failure.
- Parse JSON and branch on `code`.
- Use `message` for logs/debug only.
- Never parse human text from stderr as control flow.

Expected failure shape:

```json
{"ok":false,"code":"E_URL_INVALID","message":"URL must be absolute (e.g. https://example.com)"}
```

Some typed failures now include bounded hint metadata:

```json
{"ok":false,"code":"E_QUERY_INVALID","message":"No visible element matched click query","hints":["Retry with --frame-scope all"],"hintContext":{"frameCount":2,"matchCount":0}}
```

## Retry Envelope

- Attempts: `3`
- Backoff: `200ms`, `500ms`, `1200ms`
- Retry only when `retryable: true` for the returned `code`

## Retryable Codes (Current Runtime)

- `E_PROFILE_LOCKED`
- `E_SESSION_UNREACHABLE`
- `E_WAIT_TIMEOUT`
- `E_EVAL_TIMEOUT`
- `E_CDP_UNREACHABLE`
- `E_BROWSER_START_FAILED`
- `E_BROWSER_START_TIMEOUT`
- `E_STATE_LOCK_TIMEOUT`
- `E_STATE_LOCK_IO`
- `E_UPDATE_METADATA`
- `E_UPDATE_APPLY_FAILED`
- `E_UPDATE_HEALTHCHECK_FAILED`
- `E_SKILL_INSTALL_ATOMIC_SWAP_FAILED`
- `E_INTERNAL`

## Non-Retryable Codes (Current Runtime)

Workspace/profile input and state:

- `E_URL_INVALID`
- `E_WORKSPACE_NOT_FOUND`
- `E_WORKSPACE_INVALID`
- `E_PROFILE_INVALID`

Session/target/query input and handle integrity:

- `E_SESSION_ID_INVALID`
- `E_SESSION_NOT_FOUND`
- `E_SESSION_REQUIRED`
- `E_SESSION_EXISTS`
- `E_SESSION_CONFLICT`
- `E_TARGET_ID_INVALID`
- `E_TARGET_NOT_FOUND`
- `E_TARGET_SESSION_UNKNOWN`
- `E_TARGET_SESSION_MISMATCH`
- `E_QUERY_INVALID`
- `E_ASSERT_FAILED`
- `E_SELECTOR_INVALID`

Eval/input contract violations:

- `E_EVAL_SCRIPT_TOO_LARGE`
- `E_EVAL_RUNTIME`
- `E_EVAL_RESULT_UNSERIALIZABLE`

Browser/CDP preconditions:

- `E_CDP_INVALID`
- `E_BROWSER_NOT_FOUND`

Update policy/preconditions:

- `E_UPDATE_PRECONDITION`
- `E_UPDATE_ROLLBACK_NOT_AVAILABLE`

Skill compatibility/manifest:

- `E_SKILL_MANIFEST_INVALID`
- `E_SKILL_SOURCE_NOT_FOUND`
- `E_SKILL_COMPAT_VERSION_MISMATCH`
- `E_SKILL_COMPAT_CONTRACT_SCHEMA_MISMATCH`
- `E_SKILL_COMPAT_CONTRACT_MISMATCH`

## First-Response Triage

Use `references/troubleshooting.md` for symptom-first command bundles:

- Timeout or wait instability: `Command times out unexpectedly`.
- Target/session handle failures: `session mismatch errors`.
- Workspace/profile/lock issues: `Profile/auth flow blocks with lock or workspace errors`.
- Click succeeded but no page progress: `Click says success but page did not progress`.
- Selector/frame not found: `Needed element not found`.
- Low-signal network debugging: `Network debugging lacks signal`.
- Motion/transition instability: `Animation/scroll behavior is flaky`.
- Pre-retry cleanup and teardown: `Session/store cleanup needed before retry`.
