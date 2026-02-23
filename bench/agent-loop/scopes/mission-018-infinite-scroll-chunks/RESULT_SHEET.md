# SurfWright Result Sheet

- loopId: `surfwright-benchmark-loop`
- scopeId: `mission-018-infinite-scroll-chunks`
- missionSet: `018-infinite-scroll-chunks`
- generatedAt: `2026-02-23T12:09:09.086Z`
- iterations: `6`
- mode: `one campaign per run, one mission scope per run, fresh agent per flow+mission attempt`

## Baseline References

- chrome-mcp metrics: `tmp/zcl/mcp-comparison/output/20260223-073509Z-5m/FULL_RUN_METRICS.json`
- prior surfwright summary: `tmp/zerocontext/mcp-comparison-surfwright-only/runs/20260222-221805Z-f9b7cc/suite.run.summary.json`

## Iterations

| iter | agents | label | outcome | verified | tokens | wall ms | tools | dTokens vs prev | dWall vs prev | why (hypothesis) | change | evidence |
|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| 1 | 1 | baseline-scope | baseline | 1/1 | 84566 | 44337 | 249 | n/a | n/a | scope history baseline | no code change | baseline |
| 2 | 1 | iter-002-sample | mixed | 1/1 | 79535 | 48589 | 299 | -5.9% | +9.6% | measure post-commit variance | no code change | tokens -5031; wallMs +4252ms; toolCalls +50 |
| 3 | 1 | iter-003-sample | regressed | 1/1 | 156614 | 115428 | 628 | +96.9% | +137.6% | sample second post-commit run | no code change | tokens +77079; wallMs +66839ms; toolCalls +329 |
| 4 | 1 | iter-004-sample | mixed | 1/1 | 203122 | 120089 | 543 | +29.7% | +4.0% | sample third post-commit run | no code change | tokens +46508; wallMs +4661ms; toolCalls -85 |
| 5 | 1 | exp-01 | mixed | 1/1 | 154482 | 166510 | 556 | -23.9% | +38.7% | Core contract search should return scroll primitives in one call to cut discovery retries. | Expanded contract --core command set with scroll primitives and scroll-plan guidance. | tokens -48640; wallMs +46421ms; toolCalls +13 |
| 6 | 1 | exp-02 | regressed | 1/1 | 372221 | 204222 | 682 | +140.9% | +22.6% | Bundling selector-count sampling into scroll-plan should reduce repeated scroll-watch/count loops and wall time. | Added scroll-plan count-query options and per-step count summary in deterministic output. | tokens +217739; wallMs +37712ms; toolCalls +126 |

## Latest Snapshot

- iteration: `#6` (exp-02)
- agentsPerMission: `1`
- flowIds: `surfwright`
- outcome: `regressed`
- verified: `1/1`
- tokens: `372221`
- wall ms: `204222`
- tool calls: `682`
- headed browser calls: `0`
- run state: `tmp/zerocontext/bench-loop/surfwright-benchmark-loop/mission-018-infinite-scroll-chunks/20260223T120540Z-i006/zcl-out/campaigns/surfwright-benchmark-loop-mission-018-infinite-scroll-chunks-i006-20260223t120540z-i006/campaign.run.state.json`
- metrics: `tmp/zerocontext/bench-loop/surfwright-benchmark-loop/mission-018-infinite-scroll-chunks/20260223T120540Z-i006/report/metrics.full.json`

