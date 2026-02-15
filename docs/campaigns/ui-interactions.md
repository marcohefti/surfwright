# UI Interactions (v0 Surface Lock)

This doc locks the v0 command/flag/output naming used by the UI-interactions plan (`tmp/ui-interactions/plan.md`).

Constraints:

- No semantic UI claims (no "overlay_opened", etc.). Ship bounded evidence only.
- No implicit "current tab" state. All workflows remain handle-based (`sessionId`, `targetId`, and explicit `frameId` when used).
- If an output can grow: explicit caps + truncation flags + stable ordering.

## Naming Decisions (v0)

### Headed Mode (Managed Sessions)

- CLI input flag (canonical): `--browser-mode <headless|headed>`
  - Applies to: `session new`, `session fresh`, `session ensure`, `open`, `run`
  - Default remains `headless` (current behavior).
- Output field: `browserMode`
  - Enum values: `"headless" | "headed" | "unknown"`
  - `unknown` is used for attached sessions where mode cannot be guaranteed.
- `session list` will include `browserMode`; do not add a redundant `launchSource` field (existing `kind` already distinguishes `managed` vs `attached`).

### `open` Redirect Evidence

Additive fields on `open` output:

- `requestedUrl`: normalized URL string requested by the caller.
- `finalUrl`: resolved URL after navigation completes.
- `wasRedirected`: boolean, true when `finalUrl !== requestedUrl`.
- Optional (bounded): `redirectChain: string[]` + `redirectChainTruncated: boolean`

Back-compat:

- Keep existing `url` field as the resolved/final URL (equivalent to `finalUrl`).

### URL Assertion Primitive

- New command: `target url-assert`
- Options (v0 scope): `--host`, `--origin`, `--path-prefix`, `--url-prefix`
- Failure: typed `E_ASSERT_FAILED` on mismatch (no retries).

### Match Index Selection (0-based)

- Click match selection option: `target click --index <n>`
- Indexing is 0-based (aligned with `TargetFindReport.matches[].index` and `TargetClickReport.clicked.index`).

### Frame Handles + Eval Targeting

- New command: `target frames` (bounded list with truncation flags).
- Frame handle field: `frameId` (stable handle within the current page state).
  - Format: `f-<n>` (0-based, stable deterministic traversal order for the current page state).
- Eval targeting flag: `target eval --frame-id <id>`

### `target eval` Expression Mode (Fix "undefined spiral")

Keep existing behavior as the "function body" mode:

- Existing: `target eval --expression/--js/--script` (function body; callers must `return ...` to get a value)

Add a value-expression mode:

- New: `target eval --expr <js>` (treat input as an expression and return its value)

### Click Delta Evidence (Opt-in)

- Delta flag: `target click --delta`
- Output field: `delta` (bounded evidence-only payload; no semantic narratives)
