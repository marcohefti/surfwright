# Fixture Ingress Workflow

Use this when an edge case appears and we want deterministic regression coverage without relying on live browser behavior in every run.

## Goal

Capture a real edge case once, normalize it, and replay it in tests.

## Core Rule

Fixtures must store SurfWright-normalized contract behavior, not raw Playwright internals.

- Good: `target.find` result shape (`count`, bounded `matches` including link/tag metadata, typed errors).
- Bad: full raw CDP/Playwright payloads with volatile fields.

## When to Add a Fixture

Add an ingress fixture when at least one is true:

1. A bug/regression was found in a real page/session.
2. A new feature branch introduces a new output branch or error code.
3. An environment-specific edge case was observed (timing, selector ambiguity, truncation).

## Fixture Directory Convention

Use:

```txt
test/fixtures/ingress/<command>/<case-id>.json
```

Examples:

- `test/fixtures/ingress/target.find/multi-match-checkout.json`
- `test/fixtures/ingress/target.snapshot/truncated-text.json`

## Fixture Shape

Keep fixtures compact and stable:

```json
{
  "schemaVersion": 1,
  "caseId": "target-find-multi-match-checkout",
  "source": {
    "capturedAt": "2026-02-13T00:00:00.000Z",
    "surfaceVersion": "0.1.0",
    "note": "CamelPay homepage text query"
  },
  "command": {
    "id": "target.find",
    "input": {
      "targetId": "T123",
      "mode": "text",
      "query": "Checkout",
      "limit": 5
    }
  },
  "expect": {
    "ok": true,
    "mode": "text",
    "query": "Checkout",
    "count": 9,
    "limit": 5,
    "truncated": true
  }
}
```

## Add-Case Procedure

1. Reproduce edge case against a live session.
2. Capture only normalized command input + expected output branch.
3. Remove volatile details (timestamps, dynamic ids, unstable text where not needed).
4. Add fixture under `test/fixtures/ingress/...`.
5. Add/extend an integration test that replays this fixture.
6. Verify:
   - failing before fix (or on intentionally broken branch)
   - passing after fix
7. Run:

```bash
pnpm test
pnpm validate
```

`pnpm test` now includes a fixture replay lane (`test/ingress.fixture-replay.test.mjs`) that validates ingress fixture cases without launching a real browser.

## Seeded Cases (Current)

- `target.find` invalid selector -> `E_SELECTOR_INVALID`
- `target.find` missing query mode -> `E_QUERY_INVALID`
- `target.find` multi-match with `truncated=true`
- `target.snapshot` truncation flag behavior
- `target.list` duplicate URL with distinct `targetId` handles
- `session.attach` slow `/json/version` healthcheck succeeds with explicit timeout window
- `target.click` selector action shape + timing envelope

## Review Gate for Fixture PRs

Every ingress fixture PR should answer:

1. Why this case matters (bug/new branch/edge condition).
2. Why existing fixtures did not cover it.
3. Which command/error/output branch is now guarded.

## Agent Shortcut Phrase

When you tell an agent:

`add this as an ingress fixture`

it should:

1. create/update the relevant file under `test/fixtures/ingress/...`
2. wire/update the matching test
3. keep fixture content normalized and deterministic
