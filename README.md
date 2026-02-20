# SurfWright

[![npm version](https://img.shields.io/npm/v/%40marcohefti/surfwright?style=flat-square)](https://www.npmjs.com/package/@marcohefti/surfwright)
[![npm downloads](https://img.shields.io/npm/dt/%40marcohefti/surfwright?style=flat-square&label=npm%20downloads)](https://www.npmjs.com/package/@marcohefti/surfwright)
[![unpacked size](https://img.shields.io/npm/unpacked-size/%40marcohefti/surfwright?style=flat-square)](https://www.npmjs.com/package/@marcohefti/surfwright)
[![install size](https://img.shields.io/packagephobia/install/%40marcohefti/surfwright?style=flat-square)](https://packagephobia.com/result?p=@marcohefti/surfwright)
[![node](https://img.shields.io/node/v/%40marcohefti/surfwright?style=flat-square)](https://www.npmjs.com/package/@marcohefti/surfwright)
[![license](https://img.shields.io/github/license/marcohefti/surfwright?style=flat-square)](https://github.com/marcohefti/surfwright/blob/main/LICENSE)

You do not need a bigger browser tool.
You need a sharper one.

```txt
                      \o/
                       |
      ________________/ \___________________
    /    s  u  r  f  w  r  i  g  h  t        \
    \________________________________________/
~      ~      ~      ~      ~      ~      ~      ~      
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

SurfWright is an agent-native browser harness:

- a CLI (`surfwright`)
- a local daemon path enabled by default for fast, stateful command loops
- using Chrome/Chromium via CDP, with Playwright as the control engine

## Availability

Pre-alpha. Core `session.*` and the `open -> target.*` flow are stable enough for daily agent loops. Network, plan-runner ergonomics, and experimental effects are still moving.

## Quick Start (Recommended)

Install the skill:

```bash
npx skills add marcohefti/surfwright
```

Then tell your agent to use SurfWright. The skill contains the operational guidance.

Optional: if you run the CLI manually, check the runtime contract:

```bash
surfwright contract
```

`contract` now includes additive `guidance` entries with command signatures, examples, and proof schemas for high-traffic workflows.
Use `surfwright contract --compact` for summary-only output, and `surfwright contract --search <term>` to filter commands/errors/guidance.

Set global output shaping when you want smaller payloads without changing command behavior:

```bash
surfwright --output-shape compact open https://example.com
SURFWRIGHT_OUTPUT_SHAPE=proof surfwright target click <targetId> --text "Pricing" --proof
```

## CLI Install (Optional)

```bash
npm i -g @marcohefti/surfwright
```

```bash
brew tap marcohefti/homebrew-tap && brew install surfwright
```

then

```bash
surfwright skill install
```

## Command Map

- `workspace.*`: project-local browser profiles and profile locks.
- `session.*`: create/reuse/attach/clear browser sessions.
- `open`: open a URL and get a `targetId` + `sessionId`.
- `target.*`: inspect/read/click/eval/network against one explicit target.
- `run`: execute a JSON plan and optionally record/replay it.
- `update.*`: check/apply rollback-safe updates.

Everything is JSON-first by default.

## Common Flows

Explore and act on a page:

```bash
surfwright open https://example.com
surfwright target snapshot <targetId> --mode orient
surfwright target find <targetId> --text "Pricing" --first
surfwright target click <targetId> --text "Pricing"
surfwright target read <targetId> --selector main --chunk-size 1200 --chunk 1
```

Fast first-pass flow with explicit reuse/readiness controls:

```bash
surfwright open https://example.com --reuse active --wait-until commit
surfwright target click <targetId> --text "Pricing" --visible-only --proof
surfwright target fill <targetId> --selector "#email" --value "agent@example.com" --wait-network-idle --proof
surfwright target keypress <targetId> --key Enter --selector "#search" --wait-for-selector ".results" --proof
surfwright target style <targetId> --selector ".btn.btn-primary" --properties background-color,color,font-size,border-radius
surfwright target extract <targetId> --kind docs-commands --selector main --limit 5
surfwright target extract <targetId> --kind headings --selector main --limit 12
```

`target find` match rows include `text`, `visible`, `selectorHint`, `href`, and `tag`.
`target snapshot --mode orient` now includes additive counters (`headingsCount`, `buttonsCount`, `linksCount`, `navCount`).
`target click --proof` now includes additive `proof.countAfter` for selector-mode clicks (when post-action counting is available).
`target fill|keypress|upload|drag-drop|dialog` now support the same post-action wait controls (`--wait-for-text|--wait-for-selector|--wait-network-idle`, `--wait-timeout-ms`) and optional `--proof`.
`open|target click|target fill|target keypress|target upload|target drag-drop|target dialog|target download|target wait` support additive post-action assertions: `--assert-url-prefix`, `--assert-selector`, `--assert-text`.

Use workspace profile for persistent login state:

```bash
surfwright workspace init
surfwright open https://github.com/login --profile auth --browser-mode headed
surfwright open https://github.com --profile auth
```

Capture network evidence around an action:

```bash
surfwright target network-begin <targetId> --action-id checkout --profile api
surfwright target click <targetId> --text "Checkout"
surfwright target network-end <captureId> --view summary
```

## Docs

- Runtime contract: `surfwright contract`
- Architecture map: `ARCHITECTURE.md`
- Release policy: `docs/release-governance.md`
- Skill source: `skills/surfwright/SKILL.md`

## ZERO_CONTEXT_DAY

Declared: **February 13, 2026**

We celebrate this as the milestone where fresh agents, with near-zero guidance, successfully discovered and used SurfWright workflows on first try.

```txt
  ┌─────────────────────────────────────────────┐
  │                                             │
  │   Z E R O   C O N T E X T   D A Y          │
  │                                             │
  │   the surface spoke for itself.             │
  │                                             │
  └─────────────────────────────────────────────┘
```

## Status

Pre-alpha.
Everything can break, fast, on purpose, until the surface is right.

## The Vibe

Agent tooling should feel like a clean instrument:
no noise, no surprises, just tight feedback loops.
