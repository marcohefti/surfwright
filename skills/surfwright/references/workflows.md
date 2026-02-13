# Workflows

## 1) Bootstrap and introspect surface

```bash
surfwright --json contract
surfwright --json doctor
```

Use `contract` output as source-of-truth for command ids, usage strings, and known error codes.

## 2) Default navigation loop

```bash
surfwright --json session ensure
surfwright --json open https://example.com
surfwright --json target list
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --text "query"
```

- `session ensure` guarantees a reachable active session (or creates managed default).
- `open` returns minimal page report with `sessionId`, `targetId`, `url`, `status`, `title`.
- `target list` enumerates currently reachable page targets.
- `target snapshot` returns bounded text/headings/buttons/links for one explicit target.
- `target find` checks match counts and returns bounded match metadata for one explicit query.

## 3) Explicit session lifecycle

Create and pin a named managed session:

```bash
surfwright --json session new --session-id s-checkout
surfwright --json --session s-checkout open https://example.com
```

Attach to external Chrome endpoint:

```bash
surfwright --json session attach --cdp http://127.0.0.1:9222 --session-id a-login
surfwright --json session use a-login
```

List known sessions:

```bash
surfwright --json session list
```

## 4) Output rules

- Always parse JSON from stdout.
- Avoid `--pretty` in automated loops.
- Treat non-zero process exit as failure and decode `code` from JSON.
- Prefer `targetId` from `open` when taking snapshots; use `target list` only when recovering from lost handles.
