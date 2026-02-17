# Bugfix TDD Workflow

Use this workflow when you hit a bug in SurfWright behavior (CLI output, typed failures, CDP/page behavior, state mapping) and you want a regression guard that prevents it from coming back.

## Goal

- Minimal repro (prefer deterministic `data:` pages).
- A failing test that reproduces the bug.
- A fix that makes the test pass.
- A fast sanity pass over the operator surface.

## Step 0: Reproduce With Evidence

1. Reproduce the bug via the CLI with `--json`.
2. Capture the smallest command sequence and the exact typed failure (`code`, first-line `message`).
3. If the repro depends on a live page, first attempt to reduce it to a deterministic `data:` page. If you cannot, keep the live repro as a secondary sanity check, not as your only test.

Recommended: run with a fresh state namespace to avoid stale handle mapping:

```bash
SURFWRIGHT_STATE_DIR=$(mktemp -d /tmp/surfwright-bug-XXXXXX) \
  surfwright --json open https://example.com
```

## Step 1: Pick The Right Test Lane

Pick the smallest lane that actually guards the regression.

### Lane A: Hermetic contract test (preferred when possible)

Use when the bug is in plumbing/serialization/arg-forwarding/validation and can be tested without launching a browser.

- Location: `test/*.contract.test.mjs`
- Run: `pnpm -s test:contract`

Examples:
- “arg got dropped between layers”
- “typed failure not emitted / wrong code”
- “contract shape drift”

### Lane B: Browser contract test

Use when the bug requires an actual browser execution (CDP reachability, DOM interaction, frames, clicks, timeouts).

- Location: `test/browser/**/*.browser.mjs`
- Repro page: use `data:` URLs (no network) whenever possible.
- Run: `pnpm -s test:browser`

Rule: if a command touches a real page, try to add a `data:` browser test first.

### Lane C: Ingress fixture (normalized regression case)

Use when the bug is a real-world edge case but you cannot (yet) reduce it to a deterministic repro page.

- Location: `test/fixtures/ingress/<command>/<case-id>.json`
- Validation: `pnpm -s test:fixtures`
- Add an integration test that consumes the fixture per `docs/fixture-ingress-workflow.md`.

Important: ingress fixtures validate normalized contract behavior. They do not execute a browser by themselves.

## Step 2: Write The Failing Test First

- Ensure the test fails on `main` (or the broken commit) before you fix anything.
- Assert on stable fields:
  - `ok`, `code`, bounded `message` (first line only)
  - required keys in success payloads
  - deterministic counts / truncation flags (not full text dumps)

Prefer deterministic test pages:

```js
const html = "<title>Repro</title><button id='b'>Click</button>";
const url = `data:text/html,${encodeURIComponent(html)}`;
```

## Step 3: Fix (Smallest Surface)

- Fix the root cause, not the symptom (timeouts are not a fix).
- Keep changes localized.
- If state mapping or session inference broke, add a test that exercises the handle path explicitly.

## Step 4: Verify The Operator Surface

Run the fast sanity pass:

```bash
pnpm -s smoke
```

If your change touches browser-executing commands, also run:

```bash
pnpm -s test:browser
```

## Step 5: Close The Loop (Docs/Changelog)

- If behavior is user-visible, update `CHANGELOG.md` (`[Unreleased]`) and any relevant usage docs.
- If you changed maintainer workflow, update `docs/agent-dev-flow.md` and/or `docs/maintaining-agent-surface.md`.

