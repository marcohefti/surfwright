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
- a local daemon path enabled by default for fast, stateful command loops
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
surfwright session new [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]
surfwright session fresh [--session-id <id>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]
surfwright session attach --cdp <origin> [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--json] [--pretty]
surfwright session use <sessionId> [--timeout-ms <ms>] [--json] [--pretty]
surfwright session list [--json] [--pretty]
surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--json] [--pretty]
surfwright open <url> [--reuse-url] [--isolation <mode>] [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright run [--plan <path>|--plan-json <json>|--replay <path>] [--doctor] [--record] [--record-path <path>] [--record-label <label>] [--isolation <mode>] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target list [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target snapshot <targetId> [--selector <query>] [--visible-only] [--frame-scope <scope>] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--first] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target click <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--wait-for-text <text> | --wait-for-selector <query> | --wait-network-idle] [--snapshot] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target read <targetId> [--selector <query>] [--visible-only] [--frame-scope <scope>] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target extract <targetId> [--kind <kind>] [--selector <query>] [--visible-only] [--frame-scope <scope>] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target eval <targetId> (--expression <js> | --js <js> | --script <js>) [--arg-json <json>] [--capture-console] [--max-console <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target console-tail <targetId> [--capture-ms <ms>] [--max-events <n>] [--levels <csv>] [--reload] [--timeout-ms <ms>] [--session <id>]
surfwright target health <targetId> [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target hud <targetId> [--timeout-ms <ms>] [--fields <csv>] [--json] [--pretty] [--session <id>]
surfwright target network <targetId> [--action-id <id>] [--profile <preset>] [--view <mode>] [--fields <csv>] [--capture-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--include-headers] [--include-post-data] [--no-ws-messages] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target network-tail <targetId> [--action-id <id>] [--profile <preset>] [--capture-ms <ms>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--session <id>]
surfwright target network-query [--capture-id <id> | --artifact-id <id>] [--preset <name>] [--limit <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--json] [--pretty]
surfwright target network-begin <targetId> [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--include-headers] [--include-post-data] [--no-ws-messages] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target network-end <captureId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--json] [--pretty]
surfwright target network-export <targetId> --out <path> [--action-id <id>] [--format har] [--profile <preset>] [--capture-ms <ms>] [--max-requests <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target network-export-list [--limit <n>] [--json] [--pretty]
surfwright target network-export-prune [--max-age-hours <h>] [--max-count <n>] [--max-total-mb <n>] [--keep-files] [--json] [--pretty]
surfwright target network-check [targetId] --budget <path> [--capture-id <id>] [--artifact-id <id>] [--profile <preset>] [--capture-ms <ms>] [--fail-on-violation] [--timeout-ms <ms>] [--json] [--pretty] [--session <id>]
surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--json] [--pretty]
surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--json] [--pretty]
```

Default command execution uses a local daemon path for lower warm-start overhead.
Set `SURFWRIGHT_DAEMON=off` to force direct per-invocation execution.
Use `--agent-id <id>` (or `SURFWRIGHT_AGENT_ID`) to isolate state+daemon scope per agent.

Machine-readable runtime contract:

```bash
surfwright --json contract
```

Default workflow for agent loops:

```bash
surfwright --json open https://example.com
surfwright --json target snapshot <targetId>
surfwright --json target find <targetId> --selector a --contains "Checkout" --first --visible-only
surfwright --json target click <targetId> --text "Blog" --visible-only
surfwright --json target read <targetId> --selector main --frame-scope main --chunk-size 1200 --chunk 1
surfwright --json target extract <targetId> --kind blog --frame-scope all --limit 10
surfwright --json target eval <targetId> --js "console.log('hello from agent'); return document.title" --capture-console
surfwright --json target wait <targetId> --for-selector "h1"
surfwright target console-tail <targetId> --capture-ms 2000 --levels error,warn
surfwright --json target health <targetId>
surfwright --json target hud <targetId>
surfwright --json target network <targetId> --profile perf --view summary
surfwright target network-tail <targetId> --profile api --capture-ms 3000
surfwright --json target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright --json target network <targetId> --view table --fields id,method,status,durationMs,url
surfwright --json target network-begin <targetId> --action-id checkout-click --profile api --max-runtime-ms 600000
surfwright --json target network-end <captureId> --view summary --status 5xx
surfwright --json target network-export <targetId> --profile page --reload --capture-ms 3000 --out ./artifacts/capture.har
surfwright --json target network-export-list --limit 20
surfwright --json target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright --json target network-check <targetId> --budget ./budgets/network.json --profile perf --capture-ms 5000 --fail-on-violation
```

Plan UX examples:

```bash
surfwright --json run --doctor --plan-json '{"steps":[{"id":"open","url":"https://example.com"},{"id":"snapshot"}]}'
surfwright --json run --plan ./plan.json --record --record-label smoke
surfwright --json run --replay ~/.surfwright/runs/2026-02-13Z-smoke-abc123.json
```

Session selection defaults:

- `open` (without `--session`) creates a new isolated ephemeral managed session.
- `run` (without `--session`) starts a new isolated session and keeps it across plan steps.
- `target *` (without `--session`) infers the session from persisted `targetId` mapping.
- `target list` requires `--session` when no `targetId` is available to infer session.
- set `--isolation shared` on `open`/`run` to reuse the managed shared-session path instead.

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
{"ok":true,"sessionId":"s-1","sessionSource":"implicit-new","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2p8-1sz7jc","url":"http://camelpay.localhost/","status":200,"title":"CamelPay — Cross-chain crypto checkout","timingMs":{"total":231,"resolveSession":4,"connectCdp":33,"action":176,"persistState":18}}
```

`target snapshot` returns bounded page-read primitives for deterministic agent parsing:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","textPreview":"CamelPay is in early access ...","headings":["Cross-chain crypto checkout, made simple"],"buttons":["Start Checkout"],"links":[{"text":"Read the docs","href":"http://localhost:3002/developers/quickstart"}],"truncated":{"text":false,"headings":false,"buttons":false,"links":false},"timingMs":{"total":147,"resolveSession":4,"connectCdp":26,"action":104,"persistState":13}}
```

`target find` returns bounded match records for text/selector queries:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","mode":"text","query":"Checkout","count":9,"limit":5,"matches":[{"index":0,"text":"Cross-chain crypto checkout, made simple","visible":true,"selectorHint":"h1"}],"truncated":true,"timingMs":{"total":132,"resolveSession":3,"connectCdp":24,"action":92,"persistState":13}}
```

`target click` executes one click and returns action metadata:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2pc-9kd2rj","mode":"selector","selector":"#start-checkout","contains":null,"visibleOnly":true,"query":"#start-checkout","clicked":{"index":0,"text":"Start Checkout","visible":true,"selectorHint":"a#start-checkout.inline-flex.h-9"},"url":"http://camelpay.localhost/#checkout","title":"CamelPay — Cross-chain crypto checkout","timingMs":{"total":128,"resolveSession":4,"connectCdp":25,"action":84,"persistState":15}}
```

`target read` returns deterministic text chunks for long pages:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","scope":{"selector":"main","matched":true,"visibleOnly":true},"chunkSize":1200,"chunkIndex":1,"totalChunks":2,"totalChars":2200,"text":"Cross-chain crypto checkout, made simple ...","truncated":true,"timingMs":{"total":139,"resolveSession":4,"connectCdp":27,"action":95,"persistState":13}}
```

`target eval` executes bounded page-context JavaScript for one explicit target:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2pk-1xk9","expression":"console.log('hello from agent'); return document.title","result":{"type":"string","value":"CamelPay — Cross-chain crypto checkout","truncated":false},"console":{"captured":true,"count":1,"truncated":false,"entries":[{"level":"log","text":"hello from agent"}]},"timingMs":{"total":126,"resolveSession":4,"connectCdp":25,"action":84,"persistState":13}}
```

`target network` returns bounded request/websocket diagnostics plus performance summary, correlation ids, hints, and insights:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","captureId":null,"actionId":"a-m6m2p8-1sz7jc","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","capture":{"startedAt":"2026-02-13T12:00:00.000Z","endedAt":"2026-02-13T12:00:02.600Z","durationMs":2600,"captureMs":2500,"reload":false},"filters":{"urlContains":null,"method":null,"resourceType":null,"status":"2xx","failedOnly":false,"profile":"custom"},"view":"raw","fields":["id","method","status","durationMs","resourceType","url"],"tableRows":[],"limits":{"maxRequests":120,"maxWebSockets":24,"maxWsMessages":120},"counts":{"requestsSeen":31,"requestsReturned":24,"responsesSeen":31,"failedSeen":0,"webSocketsSeen":1,"webSocketsReturned":1,"wsMessagesSeen":14,"wsMessagesReturned":14,"droppedRequests":0,"droppedWebSockets":0,"droppedWsMessages":0},"performance":{"completedRequests":24,"bytesApproxTotal":198432,"statusBuckets":{"2xx":24,"3xx":0,"4xx":0,"5xx":0,"other":0},"latencyMs":{"min":11.2,"max":921.7,"avg":147.4,"p50":64.1,"p95":721.6},"ttfbMs":{"min":6.3,"max":680.4,"avg":83.2,"p50":41.7,"p95":421.9},"slowest":[{"id":5,"url":"https://camelpay.localhost/api/checkout","resourceType":"fetch","status":200,"durationMs":921.7}]},"truncated":{"requests":false,"webSockets":false,"wsMessages":false},"hints":{"shouldRecapture":false,"suggested":{"maxRequests":120,"maxWebSockets":24,"maxWsMessages":120}},"insights":{"topHosts":[],"errorHotspots":[],"websocketHotspots":[]},"requests":[],"webSockets":[]}
```

`target network-begin` / `target network-end` gives an action-scoped handle-based capture loop:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","captureId":"c-12","actionId":"checkout-click","status":"recording","profile":"api","startedAt":"2026-02-13T12:00:00.000Z","maxRuntimeMs":600000}
```

`target network-export` writes a compact HAR artifact and returns artifact metadata:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","format":"har","artifact":{"path":"/abs/path/capture.har","mode":"minimal","scope":"filtered","entries":24,"bytes":18212,"writtenAt":"2026-02-13T12:00:02.605Z"},"source":{"captureMs":3000,"requestsSeen":31,"requestsReturned":24,"truncatedRequests":false}}
```

`target network-export-list` returns indexed artifacts for agent reuse:

```json
{"ok":true,"total":4,"returned":4,"artifacts":[{"artifactId":"na-4","createdAt":"2026-02-13T12:00:02.605Z","format":"har","path":"/abs/path/capture.har","sessionId":"s-default","targetId":"1764200ABD63A830C21F4BF2799536D0","captureId":null,"entries":24,"bytes":18212}]}
```

`target network-query` turns saved captures/HAR into direct answers without manual file inspection:

```json
{"ok":true,"source":{"kind":"capture","id":"c-12","path":"/abs/path/c-12.result.json"},"preset":"slowest","returned":3,"rows":[{"id":5,"actionId":"checkout-click","method":"POST","status":200,"durationMs":921.7,"url":"https://camelpay.localhost/api/checkout"}],"summary":{"requests":24,"failed":0,"webSockets":1,"bytesApproxTotal":198432,"p95LatencyMs":721.6}}
```

`target network-check` evaluates runtime metrics against budget thresholds:

```json
{"ok":true,"passed":true,"source":{"kind":"capture-live","id":"1764200ABD63A830C21F4BF2799536D0"},"metrics":{"requests":24,"failures":0,"errorRate":0,"p95LatencyMs":721.6,"bytesApproxTotal":198432,"wsMessages":14},"checks":[{"name":"maxP95LatencyMs","limit":1000,"actual":721.6,"passed":true}],"budget":{"maxP95LatencyMs":1000}}
```

Errors are typed and short:

```json
{"ok":false,"code":"E_URL_INVALID","message":"URL must be absolute (e.g. https://example.com)"}
```

`--json` is compact by default (one line for easy piping). Add `--pretty` only when a human needs multiline output.

Sessions are tracked in state with an explicit active pointer:

- default: `~/.surfwright/state.json`
- agent-scoped: set `SURFWRIGHT_AGENT_ID=<agentId>` to use `~/.surfwright/agents/<agentId>/state.json`
- explicit override: `SURFWRIGHT_STATE_DIR=<path>`

`session ensure` still runs a built-in hygiene pass, but command defaults are now isolation-first:
- `open`/`run` without `--session` use new ephemeral sessions by default.
- `target *` without `--session` infer from persisted `targetId`.
- explicit `--session` always wins and is validated against `targetId` ownership.
Set `SURFWRIGHT_SESSION_LEASE_TTL_MS=<ms>` to tune session lease retention (default 72h).
Use `session new --policy persistent` for long-lived sessions and `--policy ephemeral` for disposable runs.

Guardrail: SurfWright never auto-attaches to arbitrary running browsers. Attaching to an existing browser only happens via explicit `session attach --cdp ...`.

If the endpoint is slow to answer `/json/version`, increase attach reachability window with `--timeout-ms <ms>`.

Contract ids are executable aliases. Example: `surfwright --json target.find <targetId> --text Checkout`.

## Agent Guidance In Repo

- Architecture and source-of-truth map: `docs/agent-guidance-architecture.md`
- Maintenance checklist: `docs/maintaining-agent-surface.md`
- Zero-context evaluation harness: `docs/zerocontext-lab.md`
- Installable runtime skill: `skills/surfwright/SKILL.md`

## ZERO_CONTEXT_DAY

Declared: **February 13, 2026**

We celebrate this as the milestone where fresh agents, with near-zero guidance, successfully discovered and used SurfWright workflows on first try.

```txt
   ________  ______  __       ______
  /__  __/ / __/ / / /      / ____/
    / /   / /_/ /_/ /____  / /__
   /_/    \__/\____/_____/ \___/
```

## Status

Pre-alpha.
Everything can break, fast, on purpose, until the surface is right.

## The Vibe

Agent tooling should feel like a clean instrument:
no noise, no surprises, just tight feedback loops.

If SurfWright ever starts “explaining itself” unprompted, it is failing its job.
