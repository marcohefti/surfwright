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
| 2 | modal-lifecycle | `002-modal-lifecycle.md` | `https://www.jquerymodal.com/` |
| 3 | multimatch-disambiguation | `003-multimatch-disambiguation.md` | `https://the-internet.herokuapp.com/jqueryui/menu#` |
| 4 | style-inspection | `004-style-inspection.md` | `https://example.com/` |
| 5 | login-success | `005-login-success.md` | `https://the-internet.herokuapp.com/login` |
| 6 | checkbox-toggle | `006-checkbox-toggle.md` | `https://the-internet.herokuapp.com/checkboxes` |
| 7 | dropdown-select | `007-dropdown-select.md` | `https://the-internet.herokuapp.com/dropdown` |
| 8 | javascript-alert-dialog | `008-javascript-alert-dialog.md` | `https://the-internet.herokuapp.com/javascript_alerts` |
| 9 | iframe-edit | `009-iframe-edit.md` | `https://the-internet.herokuapp.com/iframe` |
| 10 | new-window-spawn | `010-new-window-spawn.md` | `https://the-internet.herokuapp.com/windows` |
| 11 | file-upload | `011-file-upload.md` | `https://the-internet.herokuapp.com/upload` |
| 12 | dynamic-controls-enable | `012-dynamic-controls-enable.md` | `https://the-internet.herokuapp.com/dynamic_controls` |
| 13 | dynamic-loading | `013-dynamic-loading.md` | `https://the-internet.herokuapp.com/dynamic_loading/1` |
| 14 | infinite-scroll-chunks | `014-infinite-scroll-chunks.md` | `https://the-internet.herokuapp.com/infinite_scroll` |
| 15 | download-file | `015-download-file.md` | `https://the-internet.herokuapp.com/download` |
| 16 | docs-commands-extract | `016-docs-commands-extract.md` | `https://docs.astral.sh/uv/getting-started/installation/` |

## Quick Usage

- "Run mission 7" -> `007-dropdown-select.md`
- "Run mission `dropdown-select`" -> `007-dropdown-select.md`
- "Run missions 5-8" -> `005-login-success.md` to `008-javascript-alert-dialog.md`

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
