# Parity Re-Run Comparison (2026-02-14)

## Scope

- Re-ran the same 20 parity missions from `tmp/parity-gap/prompts/*.txt`.
- One mission per run, max concurrency 5, 120s timeout, traced `surfwright` commands.
- Full run artifacts live under `tmp/parity-gap/rerun-2026-02-14/`.

## Results

- Completion rate: `20/20` (`100%`).
- Implemented-feature command adoption: `18/19` (`94.74%`) missions invoked expected new command ids.
- Post-run means:
  - command count per mission: `7.25`
  - failed command count per mission: `0.25`

## Decision Shift (Evidence-Inferred)

- `missing_primitive -> already_possible_better_way`: `18`
- `missing_primitive -> naming_ux`: `1`
- `naming_ux -> already_possible_better_way`: `1`

## Residual Gap

- `click_at` remains deferred (no first-class coordinate click primitive).

## Artifacts

- Comparison report: `tmp/parity-gap/parity-rerun-comparison-2026-02-14.md`
- Aggregated metrics: `tmp/parity-gap/rerun-2026-02-14/summary.json`
