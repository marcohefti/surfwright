# Next Iteration Task

## Guardrails

- Use one mission scope and one new campaign for the next run.
- Keep model pinned to gpt-5.3-codex-spark / medium / best_effort.
- No commit/push unless explicitly requested.
- Keep run artifacts under tmp/ only.

## Latest

- scope: mission-018-infinite-scroll-chunks
- missionSet: 018-infinite-scroll-chunks
- outcome: baseline
- evidence: baseline

## Next Command

```bash
pnpm bench:loop:run \
  --label "exp-02" \
  --mission-id 018-infinite-scroll-chunks \
  --hypothesis "<why this should improve>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
node scripts/bench/summarize-history.mjs --scope-id mission-018-infinite-scroll-chunks
```

