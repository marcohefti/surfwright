# Troubleshooting

Use this runbook when loops fail under default settings. Favor evidence commands before guessing.

## 1) Command times out unexpectedly

Evidence:

```bash
surfwright target health <targetId>
surfwright target hud <targetId>
surfwright target console-get <targetId> --capture-ms 1500 --levels error,warn
```

Likely causes:

- Stale target/session handle
- Selector/query mismatch
- Navigation not settled yet

Fix path:

```bash
surfwright target wait <targetId> --for-selector "<stable-selector>" --wait-timeout-ms 2500
surfwright target snapshot <targetId> --mode orient --visible-only
surfwright target click <targetId> --text "<label>" --visible-only --explain
```

If failure payload includes `hints`/`hintContext`, prioritize those before retrying.

## 2) `E_TARGET_*` or session mismatch errors

Evidence:

```bash
surfwright session list
surfwright target list --session <sessionId>
```

Fix path:

```bash
surfwright session use <sessionId>
surfwright target health <targetId>
```

If state is stale after restart/crash:

```bash
surfwright state reconcile
```

## 3) Profile/auth flow blocks with lock or workspace errors

Evidence:

```bash
surfwright workspace info
surfwright workspace profile-locks
```

Fix path:

```bash
surfwright workspace init
surfwright workspace profile-lock-clear <profile>
surfwright open https://example.com/login --profile <profile> --browser-mode headed
```

Use `--force` on profile-lock-clear only when lock staleness is confirmed.

## 4) Click says success but page did not progress

Evidence:

```bash
surfwright target click <targetId> --text "<label>" --visible-only --delta
surfwright target snapshot <targetId> --mode orient --visible-only
```

Fix path:

```bash
surfwright target count <targetId> --text "<label>" --visible-only
surfwright target click <targetId> --text "<label>" --visible-only --index <n>
surfwright --output-shape compact target click <targetId> --text "<label>" --visible-only --repeat 2
surfwright target network-around <targetId> --click-text "<label>" --profile api --view summary
```

## 5) Needed element not found

Evidence:

```bash
surfwright target snapshot <targetId> --mode snapshot --include-selector-hints --max-links 20 --max-buttons 20
surfwright target frames <targetId>
```

Fix path:

```bash
surfwright target find <targetId> --selector "<selector>" --frame-scope all
surfwright target eval <targetId> --frame-id <frameId> --expr "document.title"
```

## 6) Network debugging lacks signal

Evidence:

```bash
surfwright target network <targetId> --profile api --view summary --capture-ms 3000
surfwright target network-tail <targetId> --profile api --capture-ms 3000 --max-events 300
```

Fix path:

```bash
surfwright target network-query --capture-id <captureId> --preset failures --limit 20
surfwright target network-export <targetId> --out ./artifacts/capture.har --profile page --capture-ms 3000
surfwright target network-check <targetId> --budget ./budgets/network.json --capture-ms 5000 --fail-on-violation
```

## 7) Animation/scroll behavior is flaky

Evidence:

```bash
surfwright target transition-trace <targetId> --click-text "<trigger>" --capture-ms 1500
surfwright target scroll-watch <targetId> --selector "<selector>" --steps 0,200,400
```

Fix path:

```bash
surfwright target motion-detect <targetId> --selector "<selector>" --duration-ms 1500
surfwright target sticky-check <targetId> --selector "<selector>" --steps 0,200,400,800
surfwright target transition-assert <targetId> --click-text "<trigger>" --cycles 3 --capture-ms 1500
```

## 8) Session/store cleanup needed before retry

```bash
surfwright session prune
surfwright target prune --max-age-hours 168 --max-per-session 200
surfwright state reconcile
surfwright state disk-prune --dry-run
surfwright session clear
```

Use `session clear --keep-processes` only when intentionally preserving running browsers.

## 9) Startup or state-lock failures (`E_BROWSER_START_*`, `E_STATE_LOCK_*`)

Failure payloads include bounded `hints` and `hintContext` (for example `lockPath`, `lockAgeMs`, `cdpOrigin`, `userDataDir`).
Use those fields first before retry loops.

Typical remediation:

```bash
surfwright doctor
surfwright session clear --timeout-ms 8000
```

For parallel runners, isolate state:

```bash
export SURFWRIGHT_STATE_DIR=/tmp/surfwright-$(date +%s)
```
