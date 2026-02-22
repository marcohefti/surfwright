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

## Mission Index

| index | mission_id | file | start_url |
|---:|---|---|---|
| 1 | docs-install-command | `001-docs-install-command.md` | `https://docs.astral.sh/uv/getting-started/installation/` |
| 2 | homepage-pricing | `002-homepage-pricing.md` | `https://github.com` |
| 3 | redirect-evidence | `003-redirect-evidence.md` | `http://example.com` |
| 4 | first-pass-orientation | `004-first-pass-orientation.md` | `https://www.w3.org/TR/WCAG22/` |
| 5 | modal-lifecycle | `005-modal-lifecycle.md` | `https://jquerymodal.com/` |
| 6 | multimatch-disambiguation | `006-multimatch-disambiguation.md` | `https://the-internet.herokuapp.com/add_remove_elements/` |
| 7 | style-inspection | `007-style-inspection.md` | `https://getbootstrap.com/docs/5.3/components/buttons/` |
| 8 | login-success | `008-login-success.md` | `https://the-internet.herokuapp.com/login` |
| 9 | checkbox-toggle | `009-checkbox-toggle.md` | `https://the-internet.herokuapp.com/checkboxes` |
| 10 | dropdown-select | `010-dropdown-select.md` | `https://the-internet.herokuapp.com/dropdown` |
| 11 | javascript-alert-dialog | `011-javascript-alert-dialog.md` | `https://the-internet.herokuapp.com/javascript_alerts` |
| 12 | iframe-edit | `012-iframe-edit.md` | `https://the-internet.herokuapp.com/iframe` |
| 13 | new-window-spawn | `013-new-window-spawn.md` | `https://the-internet.herokuapp.com/windows` |
| 14 | table-sort-lastname | `014-table-sort-lastname.md` | `https://the-internet.herokuapp.com/tables` |
| 15 | file-upload | `015-file-upload.md` | `https://the-internet.herokuapp.com/upload` |
| 16 | dynamic-controls-enable | `016-dynamic-controls-enable.md` | `https://the-internet.herokuapp.com/dynamic_controls` |
| 17 | dynamic-loading | `017-dynamic-loading.md` | `https://the-internet.herokuapp.com/dynamic_loading/1` |
| 18 | infinite-scroll-chunks | `018-infinite-scroll-chunks.md` | `https://the-internet.herokuapp.com/infinite_scroll` |
| 19 | download-file | `019-download-file.md` | `https://the-internet.herokuapp.com/download` |
| 20 | docs-commands-extract | `020-docs-commands-extract.md` | `https://docs.astral.sh/uv/getting-started/installation/` |

## Quick Usage

- "Run mission 10" -> `010-dropdown-select.md`
- "Run mission `dropdown-select`" -> `010-dropdown-select.md`
- "Run missions 5-8" -> `005-modal-lifecycle.md` to `008-login-success.md`

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
