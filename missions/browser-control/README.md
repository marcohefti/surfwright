# Browser Control Missions

This folder is the versioned, reusable mission pack for browser-control validation.

## Scope

- Runner-independent mission authoring definitions.
- No runner-specific execution commands in mission files.
- Source mission files include intent, proof fields, and authoritative success checks.
- ZCL exam-mode assets are generated from this source into split prompt/oracle directories.

## Conventions

- File format: `NNN-<mission-id>.md`
- `mission_id` is immutable.
- `index` is immutable.
- Add new missions by appending; do not renumber existing missions.
- Active campaign scope is controlled by `docs/campaigns/browser-control-native-codex.yaml` mission selection.

## Mission Index

| index | mission_id | file | start_url |
|---:|---|---|---|
| 1 | first-pass-orientation | `001-first-pass-orientation.md` | `https://the-internet.herokuapp.com/` |
| 2 | style-inspection | `002-style-inspection.md` | `https://example.com/` |
| 3 | login-success | `003-login-success.md` | `https://the-internet.herokuapp.com/login` |
| 4 | javascript-alert-dialog | `004-javascript-alert-dialog.md` | `https://the-internet.herokuapp.com/javascript_alerts` |
| 5 | iframe-edit | `005-iframe-edit.md` | `https://the-internet.herokuapp.com/iframe` |
| 6 | new-window-spawn | `006-new-window-spawn.md` | `https://the-internet.herokuapp.com/windows` |
| 7 | file-upload | `007-file-upload.md` | `https://the-internet.herokuapp.com/upload` |
| 8 | dynamic-loading | `008-dynamic-loading.md` | `https://the-internet.herokuapp.com/dynamic_loading/1` |
| 9 | infinite-scroll-chunks | `009-infinite-scroll-chunks.md` | `https://the-internet.herokuapp.com/infinite_scroll` |
| 10 | download-file | `010-download-file.md` | `https://the-internet.herokuapp.com/download` |

## Quick Usage

- "Run mission 7" -> `007-file-upload.md`
- "Run mission `iframe-edit`" -> `005-iframe-edit.md`
- "Run missions 5-8" -> `005-iframe-edit.md` to `008-dynamic-loading.md`

## ZCL Integration

- Native campaign spec: `docs/campaigns/browser-control-native-codex.yaml`
- Runbook: `docs/campaigns/browser-control-zcl-native.md`
- Prompt set (agent-visible): `missions/browser-control/prompts/*.md`
- Oracle set (host-evaluated): `missions/browser-control/oracles/*.json`
- Oracle evaluator: `scripts/zcl/eval-browser-control-oracle.mjs`

## Regeneration

When source missions change, regenerate the split prompt/oracle assets:

```bash
node scripts/zcl/build-browser-control-exam-pack.mjs
```
