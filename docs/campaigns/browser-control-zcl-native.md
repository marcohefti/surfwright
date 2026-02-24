# Browser-Control ZCL Native Campaign

This runbook defines the versioned ZCL workflow for SurfWright's browser-control mission pack.

## Goals

- Keep campaign config in version control.
- Run the 20 mission browser-control pack with native Codex runtime (`codex_app_server`).
- Produce trace-backed feedback artifacts we can use to improve the SurfWright surface.

## Files

- Campaign spec: `docs/campaigns/browser-control-native-codex.yaml`
- Prompt set (agent-visible): `missions/browser-control/prompts/*.md`
- Oracle set (host-evaluated): `missions/browser-control/oracles/*.json`
- Bench-loop oracle evaluator script: `scripts/zcl/eval-browser-control-oracle.mjs`
- Prompt/oracle generator: `scripts/zcl/build-browser-control-exam-pack.mjs`
- Mission authoring source: `missions/browser-control/*.md`

## Design Notes

- Prompt mode is `exam` with split sources:
  - `missionSource.promptSource.path`: concise agent prompt only (task + output keys).
  - `missionSource.oracleSource.path`: host-side oracle rules (not copied into prompts).
- Finalization is `auto_from_result_json` with `resultChannel=file_json` (`mission.result.json`).
- Mission selection is explicit by mission id to lock scope to exactly 20 missions and avoid accidental inclusion of non-mission markdown files.
- Campaign evaluation is `oracle` with built-in rules and normalized matching (`evaluation.oraclePolicy.mode=normalized`).
- Runtime is native (`runner.type=codex_app_server`, `sessionIsolation=native`), with deterministic fresh session per attempt.
- Model is pinned in campaign config (`runner.model: gpt-5.3-codex-spark`).
- Reasoning effort hint is pinned to `medium` with `runner.modelReasoningPolicy: best_effort` (fallback to runtime default if unsupported).
- Inflight native session cap is set to `6` (`ZCL_NATIVE_MAX_INFLIGHT_PER_STRATEGY`) to align with repo ZeroContext concurrency guardrail.
- The spec intentionally omits explicit `output.*` paths so `--out-root` fully controls routine-scoped artifact placement.
- Oracle visibility is `workspace` because this campaign is fully versioned in-repo.

## Regenerate Prompt/Oracle Split

When mission authoring files (`missions/browser-control/*.md`) change, regenerate exam assets:

```bash
node scripts/zcl/build-browser-control-exam-pack.mjs
```

## Preflight (No Mission Execution)

```bash
SPEC="docs/campaigns/browser-control-native-codex.yaml"
OUT_ROOT="tmp/zerocontext/<routine-id>"

zcl campaign lint --spec "$SPEC" --out-root "$OUT_ROOT" --json
zcl campaign doctor --spec "$SPEC" --out-root "$OUT_ROOT" --json
```

## Run Commands (When You Intentionally Execute)

```bash
SPEC="docs/campaigns/browser-control-native-codex.yaml"
OUT_ROOT="tmp/zerocontext/<routine-id>"
CAMPAIGN_ID="surfwright-browser-control-native"
```

Canary:

```bash
zcl campaign canary --spec "$SPEC" --out-root "$OUT_ROOT" --missions 3 --json
```

Full run (20 missions):

```bash
zcl campaign run --spec "$SPEC" --out-root "$OUT_ROOT" --json
```

Resume / status:

```bash
zcl campaign resume --campaign-id "$CAMPAIGN_ID" --out-root "$OUT_ROOT" --json
zcl campaign status --campaign-id "$CAMPAIGN_ID" --out-root "$OUT_ROOT" --json
```

## Reporting + Feedback Triage

Generate run summary:

```bash
zcl campaign report --spec "$SPEC" --out-root "$OUT_ROOT" --json
```

Enforce SurfWright token-efficiency budgets on produced attempts:

```bash
pnpm zcl:efficiency:check --run "$OUT_ROOT/runs/<runId>"
```

List failing attempts:

```bash
zcl attempt list \
  --out-root "$OUT_ROOT" \
  --suite surfwright-browser-control-native-mission-pack \
  --status fail \
  --limit 200 \
  --json
```

Deep dive one attempt:

```bash
zcl attempt explain --json <attemptDir>
zcl report --strict --json <attemptDir>
zcl validate --strict --json <attemptDir>
```

## Improvement Loop

1. Aggregate top failure codes and repeated friction patterns from `campaign.report.json` + failed `attempt.report.json`.
2. Map issues to generic SurfWright surface changes (commands/output/errors), not mission-specific shortcuts.
3. Add/adjust contract tests first, then implement surface changes.
4. Re-run canary before full mission sweep and keep `zcl:efficiency:check` green.
