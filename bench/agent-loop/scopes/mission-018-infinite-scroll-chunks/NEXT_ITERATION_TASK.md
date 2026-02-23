# Next Iteration Task

## Guardrails

- Use one mission scope and one new campaign for the next run.
- Keep `agentsPerMission` explicit per scope (`bench/agent-loop/config.json` or `--agents-per-mission`).
- Keep model pinned to gpt-5.3-codex-spark / medium / best_effort.
- No commit/push unless explicitly requested.
- Keep run artifacts under tmp/ only.

## Latest

- scope: mission-018-infinite-scroll-chunks
- missionSet: 018-infinite-scroll-chunks
- outcome: regressed
- evidence: tokens -105716; wallMs -10274ms; toolCalls -151

## Next Command

```bash
pnpm bench:loop:run \
  --label "exp-12" \
  --mission-id 018-infinite-scroll-chunks \
  --agents-per-mission 1 \
  --hypothesis "<why this should improve>" \
  --change "<what changed>" \
  --tags <tag1>,<tag2>
node scripts/bench/summarize-history.mjs --scope-id mission-018-infinite-scroll-chunks
```

