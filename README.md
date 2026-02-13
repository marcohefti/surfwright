# SurfWright

You do not need a bigger browser tool.
You need a sharper one.

```txt
                 .  .  .  .  .
              .                 .
           .     surfwright      .
              .                 .
                 .  .  .  .  .
```

SurfWright is a CLI-first browser control surface designed for agents:

- Composable commands (small enough to chain, strong enough to trust)
- Deterministic output (machines like JSON; humans like brevity)
- Real observability (console, errors, network) without devtools theater

Think: “surf the web”, but with a board that does not talk back.

## The Contract

SurfWright aims to be boring in all the right ways:

- Outputs are bounded and predictable (no surprise novels).
- State is explicit (handles in, handles out).
- Failures are typed (short codes, actionable messages).
- Every operation is interruptible (timeouts and aborts are mandatory).

## Noise vs Signal

```txt
noisy tooling:
  .------------------------------------------.
  | [INFO] ...                               |
  | [INFO] ... [INFO] ... [WARN] ...         |
  | [INFO] ... [INFO] ... [INFO] ...         |
  | [DEBUG] ... [INFO] ... [TRACE] ...       |
  '------------------------------------------'

surfwright:
  .------------------------------------------.
  | {"ok":true,"targetId":"t1","url":"..."}   |
  '------------------------------------------'
```

## Why This Exists

Browser automation is easy to demo and hard to operate.
Most tools either:

- dump walls of text,
- hide state in magic globals,
- or fuse 12 actions into one brittle macro.

SurfWright goes the other way:

- return handles (`targetId`, `sessionId`),
- keep outputs bounded,
- make every step explicit,
- and let agents compose the run.

## What It Is (High Level)

SurfWright is a new agent-native browser harness:

- a CLI (`surfwright`)
- (soon) a local daemon for fast, stateful sessions
- using Chrome/Chromium via CDP, with Playwright as the control engine

## Quick Start

```bash
pnpm i
pnpm skill:validate
pnpm dev -- doctor
pnpm dev -- --help
```

Install/update the local SurfWright skill into Codex:

```bash
pnpm skill:install
```

## Commands (Current)

```bash
surfwright doctor [--json] [--pretty]
surfwright contract [--json] [--pretty]
surfwright session ensure [--timeout-ms <ms>] [--json] [--pretty]
surfwright session new [--session-id <id>] [--timeout-ms <ms>] [--json] [--pretty]
surfwright session attach --cdp <origin> [--session-id <id>] [--json] [--pretty]
surfwright session use <sessionId> [--timeout-ms <ms>] [--json] [--pretty]
surfwright session list [--json] [--pretty]
surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--json] [--pretty]
surfwright open <url> [--reuse-url] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target list [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target snapshot <targetId> [--selector <query>] [--visible-only] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--first] [--limit <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target read <targetId> [--selector <query>] [--visible-only] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--json] [--pretty]
surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--json] [--pretty]
```

Machine-readable runtime contract:

```bash
surfwright --json contract
```

Default workflow for agent loops:

```bash
surfwright --json session ensure
surfwright --json open https://example.com --reuse-url
surfwright --json target list
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "Checkout" --first --visible-only
surfwright --json target read <targetId> --selector main --chunk-size 1200 --chunk 1
surfwright --json target wait <targetId> --for-selector "h1"
```

State hygiene workflow for stale local metadata:

```bash
surfwright --json session prune
surfwright --json target prune --max-age-hours 168 --max-per-session 200
surfwright --json state reconcile
```

- `session prune` removes unreachable attached sessions and repairs stale managed `browserPid`.
- `target prune` removes orphaned/aged targets and caps retained targets per session.
- `state reconcile` runs both in one pass (recommended after host/browser restarts).

`open` intentionally returns a minimal success shape for agent loops:

```json
{"ok":true,"sessionId":"s-default","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","status":200,"title":"CamelPay — Cross-chain crypto checkout"}
```

`target snapshot` returns bounded page-read primitives for deterministic agent parsing:

```json
{"ok":true,"sessionId":"s-default","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","textPreview":"CamelPay is in early access ...","headings":["Cross-chain crypto checkout, made simple"],"buttons":["Start Checkout"],"links":[{"text":"Read the docs","href":"http://localhost:3002/developers/quickstart"}],"truncated":{"text":false,"headings":false,"buttons":false,"links":false}}
```

`target find` returns bounded match records for text/selector queries:

```json
{"ok":true,"sessionId":"s-default","targetId":"1764200ABD63A830C21F4BF2799536D0","mode":"text","query":"Checkout","count":9,"limit":5,"matches":[{"index":0,"text":"Cross-chain crypto checkout, made simple","visible":true,"selectorHint":"h1"}],"truncated":true}
```

`target read` returns deterministic text chunks for long pages:

```json
{"ok":true,"sessionId":"s-default","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","scope":{"selector":"main","matched":true,"visibleOnly":true},"chunkSize":1200,"chunkIndex":1,"totalChunks":2,"totalChars":2200,"text":"Cross-chain crypto checkout, made simple ...","truncated":true}
```

Errors are typed and short:

```json
{"ok":false,"code":"E_URL_INVALID","message":"URL must be absolute (e.g. https://example.com)"}
```

`--json` is compact by default (one line for easy piping). Add `--pretty` only when a human needs multiline output.

Sessions are tracked in `~/.surfwright/state.json` (or `SURFWRIGHT_STATE_DIR`) with an explicit active pointer.

Guardrail: SurfWright never auto-attaches to arbitrary running browsers. Attaching to an existing browser only happens via explicit `session attach --cdp ...`.

## Agent Guidance In Repo

- Architecture and source-of-truth map: `docs/agent-guidance-architecture.md`
- Maintenance checklist: `docs/maintaining-agent-surface.md`
- Installable runtime skill: `skills/surfwright/SKILL.md`

## Status

Pre-alpha.
Everything can break, fast, on purpose, until the surface is right.

## The Vibe

Agent tooling should feel like a clean instrument:
no noise, no surprises, just tight feedback loops.

If SurfWright ever starts “explaining itself” unprompted, it is failing its job.
