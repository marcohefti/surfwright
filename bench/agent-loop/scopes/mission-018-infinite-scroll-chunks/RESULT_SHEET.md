# SurfWright Result Sheet

- loopId: `surfwright-benchmark-loop`
- scopeId: `mission-018-infinite-scroll-chunks`
- missionSet: `018-infinite-scroll-chunks`
- generatedAt: `2026-02-23T12:41:36.809Z`
- iterations: `10`
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
| 7 | 1 | exp-03 | regressed | 0/1 | 78971 | 99692 | 278 | -78.8% | -51.2% | Providing explicit run step schema/examples in contract guidance should reduce run-plan trial-and-error and source probing. | Added run guidance to contract with supported step ids and plan-json examples. | tokens -293250; wallMs -104530ms; toolCalls -404 |
| 8 | 1 | exp-04 | mixed | 1/1 | 154341 | 56397 | 307 | +95.4% | -43.4% | Treating scroll-plan steps in (0,1] as ratio-to-bottom should make agent step=1 loops actually load chunks and improve verification reliability. | Added ratio step semantics to scroll-plan with requestedUnit reporting and updated guidance/examples. | tokens +75370; wallMs -43295ms; toolCalls +29 |
| 9 | 1 | exp-05 | failed | - | 0 | 0 | 0 | n/a | n/a | Allowing scroll-plan inside run plans should reduce ad-hoc eval loops and make multi-step scroll counting more deterministic. | Added scroll-plan pipeline step support in run plan lint/executor/runtime and updated run guidance step ids. | no metrics |
| 10 | 1 | exp-06 | failed | - | 0 | 0 | 0 | n/a | n/a | A bounded repeat-until run step should reduce ad-hoc shell retry loops and cut token/tool overhead for dynamic scroll verification. | Added run repeat-until step with bounded maxAttempts and path-based completion conditions. | no metrics |

## Latest Snapshot

- iteration: `#8` (exp-04)
- agentsPerMission: `1`
- flowIds: `surfwright`
- outcome: `mixed`
- verified: `1/1`
- tokens: `154341`
- wall ms: `56397`
- tool calls: `307`
- headed browser calls: `0`
- run state: `tmp/zerocontext/bench-loop/surfwright-benchmark-loop/mission-018-infinite-scroll-chunks/20260223T121551Z-i008/zcl-out/campaigns/surfwright-benchmark-loop-mission-018-infinite-scroll-chunks-i008-20260223t121551z-i008/campaign.run.state.json`
- metrics: `tmp/zerocontext/bench-loop/surfwright-benchmark-loop/mission-018-infinite-scroll-chunks/20260223T121551Z-i008/report/metrics.full.json`

