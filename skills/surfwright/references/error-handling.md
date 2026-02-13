# Error Handling

## Retry policy

Retryable codes (bounded retries with backoff):

- `E_CDP_UNREACHABLE`
- `E_BROWSER_START_FAILED`
- `E_BROWSER_START_TIMEOUT`
- `E_STATE_LOCK_TIMEOUT`
- `E_STATE_LOCK_IO`
- `E_WAIT_TIMEOUT`
- `E_INTERNAL`

Non-retryable codes (fix input/config first):

- `E_URL_INVALID`
- `E_CDP_INVALID`
- `E_SESSION_ID_INVALID`
- `E_SESSION_EXISTS`
- `E_SESSION_NOT_FOUND`
- `E_SESSION_REQUIRED`
- `E_SESSION_CONFLICT`
- `E_TARGET_ID_INVALID`
- `E_TARGET_NOT_FOUND`
- `E_TARGET_SESSION_UNKNOWN`
- `E_TARGET_SESSION_MISMATCH`
- `E_QUERY_INVALID`
- `E_EVAL_SCRIPT_TOO_LARGE`
- `E_EVAL_RUNTIME`
- `E_EVAL_RESULT_UNSERIALIZABLE`
- `E_SELECTOR_INVALID`
- `E_BROWSER_NOT_FOUND`

Context-sensitive:

- `E_SESSION_UNREACHABLE`: attached session endpoint is down; re-attach explicitly.
- `E_EVAL_TIMEOUT`: retryable timeout when page-context evaluation exceeds deadline.

## Suggested backoff envelope

- Attempts: 3
- Backoff: 200ms, 500ms, 1200ms
- Stop early for non-retryable codes

## Failure payload contract

Expected compact JSON shape:

```json
{"ok":false,"code":"E_URL_INVALID","message":"URL must be absolute (e.g. https://example.com)"}
```

Always branch on `code`; message is for logs and operator debugging.
