# Campaign Docs

Versioned campaign assets for repeatable agent-evaluation workflows.

## Current Campaigns

- Browser-control native Codex baseline:
  - Spec: `docs/campaigns/browser-control-native-codex.yaml`
  - Runbook: `docs/campaigns/browser-control-zcl-native.md`
  - Prompt set: `missions/browser-control/prompts/*.md`
  - Oracle set: `missions/browser-control/oracles/*.json`
- SurfWright scoped benchmark loop:
  - Runbook: `docs/campaigns/browser-control-surfwright-loop.md`
  - Loop config: `bench/agent-loop/config.json`
  - Scope histories/results: `bench/agent-loop/scopes/<scopeId>/...`
