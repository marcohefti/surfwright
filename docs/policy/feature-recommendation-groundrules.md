# Feature Recommendation Groundrules

Use this policy whenever discussing adjustments, optimizations, evaluations, or new features.

## Scope Rule (Non-Negotiable)

- Do not optimize for specific pages.
- Do not optimize for specific "kinds" of pages.
- Optimize SurfWright for cross-site utility so changes benefit operators on any page.

## What To Optimize For

- Efficiency: fewer commands, fewer retries, lower wall time.
- Resourcefulness: higher signal per command, smaller output for the same decision quality.
- Determinism: stable JSON shape, typed failures, explicit handles.
- Generality: primitives and output contracts that transfer across domains and app types.

## What Not To Ship

- Site-specific commands, aliases, or selector shortcuts.
- Bench-only hacks that do not generalize.
- "Kind-of-page" branches in runtime behavior.
- Timeout increases as a primary fix.

## Evidence Standard

- Recommendations must be trace-backed (tool calls, reports, failure codes, timings).
- Self-reports are secondary; observed behavior is primary.
- Claims about speed or reliability must cite concrete run evidence.

## Recommendation Output Contract (Required)

Every recommendation set must include:

1. Groundrules compliance check:
   - page-specific optimization avoided: yes/no
   - kind-of-page optimization avoided: yes/no
   - cross-site benefit explained: yes/no
   - evidence cited: yes/no
2. Generic surface change proposal:
   - command/contract delta
   - expected efficiency/resourcefulness impact
   - risks/tradeoffs
3. Validation plan:
   - at least one neutral fixture or multi-site check
   - success metrics (tool calls, failure rate, wall time, token cost)

## Decision Gate

If a proposal fails the scope rule, reject it and replace it with a generic primitive/output-shape alternative.
