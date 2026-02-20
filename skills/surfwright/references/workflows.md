# Workflows

## Preflight contract and health

```bash
surfwright --json contract
surfwright doctor
```

Use the live contract as authoritative command/flag/error truth.

## Handle recovery

```bash
surfwright session list
surfwright target list --session <sessionId>
surfwright target health <targetId>
```

Use this when you lost `targetId`/`sessionId` in agent state.

## Session lifecycle patterns

Default task-scoped headless lifecycle (recommended):

```bash
AID="task-$(date +%s)"
SESSION=$(surfwright --agent-id "$AID" session fresh --browser-mode headless | jq -r '.sessionId')
OPEN=$(surfwright --agent-id "$AID" open https://example.com --session "$SESSION" --reuse off --browser-mode headless)
TARGET=$(printf '%s' "$OPEN" | jq -r '.targetId')
surfwright --agent-id "$AID" target snapshot "$TARGET" --mode orient --visible-only
surfwright --agent-id "$AID" session clear
```

`session clear` operates within the current `--agent-id` namespace. With a unique `AID` per task, teardown removes only that task's state/session/processes.

Shared/continuity lifecycle (opt-in override only):

Use this only when the prompt explicitly asks to continue in existing session state.

```bash
surfwright session ensure
surfwright open https://example.com --reuse active --wait-until commit
surfwright open https://example.com/docs --reuse origin --wait-until domcontentloaded
```

Create pinned or ephemeral sessions:

```bash
surfwright session new --session-id s-checkout
surfwright session fresh
```

Attach external Chrome and switch active pointer:

```bash
surfwright session attach --cdp http://127.0.0.1:9222 --session-id a-login
surfwright session use a-login
```

Copy scoped cookies between sessions:

```bash
surfwright session cookie-copy --from-session a-login --to-session s-checkout --url https://dashboard.stripe.com --url https://access.stripe.com
```

## Workspace profile auth and lock handling

Initialize/check workspace:

```bash
surfwright workspace init
surfwright workspace info
```

Persist project login with profile:

```bash
surfwright open https://github.com/login --profile auth --browser-mode headed
surfwright open https://github.com --profile auth
```

Inspect and clear stale profile locks:

```bash
surfwright workspace profile-locks
surfwright workspace profile-lock-clear auth
surfwright workspace profile-lock-clear auth --force
```

## Robust targeting and click strategies

Count first, then click deterministically:

```bash
surfwright target count <targetId> --text "Delete" --visible-only
surfwright target click <targetId> --text "Delete" --visible-only --index 1
```

One-shot click evidence payload (post-click proof):

```bash
surfwright target click <targetId> --text "Pricing" --visible-only --proof
```

For selector-mode clicks, proof includes additive `countAfter` (post-action selector cardinality when available).
The same post-action wait switches also apply to `target fill`, `target keypress`, `target upload`, `target drag-drop`, and `target dialog`.

Narrow link matches by destination host/path:

```bash
surfwright target find <targetId> --text "Repository" --href-host github.com --href-path-prefix /marcohefti/ --visible-only
```

Explain why a match was rejected (no click executed):

```bash
surfwright target click <targetId> --text "Delete" --visible-only --explain
```

Use accessibility handle inventory for precise actions:

```bash
SNAP=$(surfwright target snapshot <targetId> --mode a11y --max-ax-rows 60)
HANDLE=$(printf '%s' "$SNAP" | jq -r '.a11y.rows[] | select(.role=="link") | .handle' | head -n 1)
surfwright target click <targetId> --handle "$HANDLE"
```

Diff before/after state with bounded signal:

```bash
surfwright target snapshot <targetId> > ./artifacts/snap-a.json
surfwright target click <targetId> --text "Next" --visible-only
surfwright target snapshot <targetId> > ./artifacts/snap-b.json
surfwright target snapshot-diff ./artifacts/snap-a.json ./artifacts/snap-b.json
```

After any click, inspect `handoff` in the JSON output to detect whether a new target opened (`sameTarget=false`) and chain directly via `openedTargetId`.

Inspect computed styles without `target eval`:

```bash
surfwright target style <targetId> --selector ".btn.btn-primary" --properties background-color,color,font-size,border-radius
surfwright target style <targetId> --selector ".btn.btn-primary" --kind button-primary
```

## Form/file/input actions

```bash
surfwright target fill <targetId> --selector "#email" --value "agent@example.com"
surfwright target fill <targetId> --selector "#email" --value "agent@example.com" --wait-network-idle --proof
surfwright target form-fill <targetId> --field "#email=agent@example.com" --field "#agree=true"
surfwright target upload <targetId> --selector "input[type=file]" --file ./assets/avatar.png --proof
surfwright target keypress <targetId> --key Enter --selector "input[name=search]" --wait-for-selector ".results" --proof
surfwright target drag-drop <targetId> --from "#card-a" --to "#column-done" --proof
surfwright target dialog <targetId> --action accept --trigger-selector "#confirm" --proof
surfwright target click-at <targetId> --x 120 --y 80
surfwright target spawn <targetId> --selector "a[target=_blank]"
surfwright target close <targetId>
surfwright target emulate <targetId> --width 390 --height 844 --color-scheme dark --touch --device-scale-factor 2
```

## Read/extract/eval/wait flows

Frame-aware introspection:

```bash
surfwright target frames <targetId>
surfwright target eval <targetId> --frame-id f-1 --expr "document.title"
```

Structured content and readiness checks:

```bash
surfwright target extract <targetId> --kind blog --include-actionable --limit 10
surfwright target extract <targetId> --kind docs-commands --selector main --limit 10
surfwright target extract <targetId> --kind headings --selector main --limit 20
surfwright target extract <targetId> --kind links --selector main --limit 20
surfwright target extract <targetId> --kind codeblocks --selector main --limit 10
surfwright target extract <targetId> --kind forms --selector main --limit 10
surfwright target extract <targetId> --kind tables --selector main --limit 10
surfwright target wait <targetId> --for-selector "h1" --wait-timeout-ms 2500
surfwright target url-assert <targetId> --host github.com --path-prefix /pricing
surfwright target hover <targetId> --text "Pricing" --visible-only
```

`target snapshot --mode orient` includes additive aggregate counters: `headingsCount`, `buttonsCount`, `linksCount`, and `navCount`.

## Evidence capture (console/network/trace/artifacts)

Console evidence:

```bash
surfwright target console-get <targetId> --capture-ms 1200 --levels error,warn
surfwright target console-tail <targetId> --capture-ms 3000 --max-events 200 --levels error,warn
```

Network capture around one click:

```bash
surfwright target network-around <targetId> --click-text "Checkout" --profile api --view summary
```

Manual begin/end capture:

```bash
surfwright target network-begin <targetId> --action-id checkout --profile api
surfwright target click <targetId> --text "Checkout" --visible-only
surfwright target network-end <captureId> --view summary --status 5xx
```

Export/query/check:

```bash
surfwright target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright target network-export <targetId> --out ./artifacts/capture.har --profile page --capture-ms 3000
surfwright target network-export-list --limit 20
surfwright target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright target network-check <targetId> --budget ./budgets/network.json --capture-ms 5000 --fail-on-violation
```

Trace capture:

```bash
surfwright target trace begin <targetId> --action-id checkout --profile perf
surfwright target trace export --trace-id <traceId> --out ./artifacts/trace.json.gz --format json.gz
surfwright target trace insight <targetId> --capture-ms 2000
```

Page artifacts:

```bash
surfwright target screenshot <targetId> --out ./artifacts/page.png --full-page
surfwright target download <targetId> --text "Export CSV" --visible-only
```

## Effects and motion diagnostics

Observe one property over time:

```bash
surfwright target observe <targetId> --selector ".card" --property opacity --duration-ms 1200 --interval-ms 100
surfwright target motion-detect <targetId> --selector ".toast" --property transform --duration-ms 1500
```

Scroll-based diagnostics:

```bash
surfwright target scroll-plan <targetId> --steps 0,300,600 --settle-ms 150
surfwright target scroll-sample <targetId> --selector ".hero" --property opacity --steps 0,300,600
surfwright target scroll-watch <targetId> --selector ".sticky-nav" --steps 0,200,400 --properties position,top
surfwright target scroll-reveal-scan <targetId> --max-candidates 20 --steps 0,400,800
surfwright target sticky-check <targetId> --selector ".sticky-nav" --steps 0,200,400,800
```

Transition diagnostics:

```bash
surfwright target transition-trace <targetId> --click-text "Open modal" --capture-ms 1500
surfwright target transition-assert <targetId> --click-text "Open modal" --cycles 3 --capture-ms 1500
```

Experimental coverage scaffold:

```bash
surfwright exp effects <targetId> --profile default
```

## Plan runner and NDJSON logs

```bash
surfwright run --plan ./plan.json --log-ndjson ./artifacts/run.ndjson --log-mode full
```

For tails, consume NDJSON until the final capture-end event.

## Extension lifecycle

```bash
surfwright extension load ./assets/extensions/minimal-extension
surfwright extension list
surfwright extension reload "Minimal Example Extension"
surfwright extension uninstall "Minimal Example Extension"
surfwright extension uninstall "missing-extension" --fail-if-missing
```

## Skill lifecycle commands

```bash
surfwright skill install
surfwright skill doctor
surfwright skill update
```

Use this when validating local skill/runtime compatibility after contract changes.

## Runtime update lifecycle

```bash
surfwright update check
surfwright update run --dry-run
surfwright update rollback --dry-run
```

Use non-dry-run only when operator policy allows runtime mutation.

## State hygiene and teardown

Targeted cleanup:

```bash
surfwright session prune
surfwright target prune --max-age-hours 168 --max-per-session 200
```

One-command recovery:

```bash
surfwright state reconcile
```

Full teardown:

```bash
surfwright session clear
surfwright session clear --keep-processes
```

When following the default task-scoped lifecycle, always run `session clear` with the same `--agent-id` used for the task so teardown is isolated to that task namespace.
