# SurfWright

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

SurfWright is a new agent-native browser harness:

- a CLI (`surfwright`)
- a local daemon path enabled by default for fast, stateful command loops
- using Chrome/Chromium via CDP, with Playwright as the control engine

## Availability

`channel: pre-alpha` `compatibility: unstable` `support: best-effort` `last-verified: 2026-02-14`

| Surface | Availability | Notes |
|---|---|---|
| `session.*` | stable | Core reusable session lifecycle for deterministic agent loops. |
| `open` + `target.*` core flow | stable | Primary browser-control surface. |
| `target.network*` | beta | Shape may expand; avoid strict parsing of optional insight fields. |
| `run` plan workflow | beta | Plan ergonomics still evolving. |
| `exp effects` | experimental | Subject to fast iteration and breaking changes. |

### Availability Legend

- `stable`: no breaking change in patch releases; deprecation path required.
- `beta`: mostly reliable; minor-version breaking changes allowed with changelog callout.
- `experimental`: breaking changes can happen in any release.
- `deprecated`: still available with explicit removal target in changelog.

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

## Install Matrix

| Channel | Command |
|---|---|
| npm canonical | `npm i -g @marcohefti/surfwright` |
| npm guard/discoverability | `npm i -g surfwright` |
| one-off canonical | `npx -y @marcohefti/surfwright@latest contract` |
| one-off guard | `npx -y surfwright@latest contract` |
| pnpm dlx canonical | `pnpm dlx @marcohefti/surfwright@latest contract` |
| pnpm dlx guard | `pnpm dlx surfwright@latest contract` |
| Homebrew tap | `brew tap marcohefti/homebrew-tap && brew install surfwright` |

Homebrew upgrade path:

```bash
brew update
brew upgrade surfwright
```

Deferred distribution channels and enablement checklists are tracked in `docs/release-governance.md`.

## Commands (Current)

```bash
surfwright doctor [--no-json] [--pretty]
surfwright contract [--no-json] [--pretty]
surfwright session ensure [--browser-mode <headless|headed>] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session new [--session-id <id>] [--browser-mode <headless|headed>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session fresh [--session-id <id>] [--browser-mode <headless|headed>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session attach --cdp <origin> [--session-id <id>] [--policy <policy>] [--lease-ttl-ms <ms>] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session use <sessionId> [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session list [--no-json] [--pretty]
surfwright session prune [--drop-managed-unreachable] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session clear [--keep-processes] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright session cookie-copy --from-session <id> --to-session <id> --url <url> [--url <url> ...] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright open <url> [--reuse-url] [--browser-mode <headless|headed>] [--isolation <mode>] [--timeout-ms <ms>] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright run [--plan <path>|--plan-json <json>|--replay <path>] [--doctor] [--record] [--record-path <path>] [--record-label <label>] [--browser-mode <headless|headed>] [--isolation <mode>] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright update check [--package <name>] [--channel <stable|beta|dev>] [--policy <manual|pinned|safe-patch>] [--pinned-version <x.y.z>] [--check-on-start <true|false>] [--no-json] [--pretty]
surfwright update run [--package <name>] [--channel <stable|beta|dev>] [--policy <manual|pinned|safe-patch>] [--pinned-version <x.y.z>] [--check-on-start <true|false>] [--dry-run] [--no-json] [--pretty]
surfwright update rollback [--package <name>] [--dry-run] [--no-json] [--pretty]
surfwright skill install [--source <path>] [--dest <path>] [--lock <path>] [--no-json] [--pretty]
surfwright skill doctor [--dest <path>] [--lock <path>] [--no-json] [--pretty]
surfwright skill update [--source <path>] [--dest <path>] [--lock <path>] [--no-json] [--pretty]
surfwright target list [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target frames <targetId> [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target snapshot <targetId> [--mode <snapshot|orient>] [--selector <query>] [--visible-only] [--frame-scope <scope>] [--cursor <token>] [--include-selector-hints] [--max-chars <n>] [--max-headings <n>] [--max-buttons <n>] [--max-links <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target count <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--frame-scope <scope>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target find <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--frame-scope <scope>] [--first] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target click <targetId> (--text <query> | --selector <query>) [--contains <text>] [--visible-only] [--frame-scope <scope>] [--index <n>] [--explain] [--wait-for-text <text> | --wait-for-selector <query> | --wait-network-idle] [--snapshot] [--delta] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target read <targetId> [--selector <query>] [--visible-only] [--frame-scope <scope>] [--chunk-size <n>] [--chunk <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target extract <targetId> [--kind <kind>] [--selector <query>] [--visible-only] [--frame-scope <scope>] [--limit <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target eval <targetId> (--expr <js> | --expression <js> | --js <js> | --script <js> | --script-file <path>) [--arg-json <json>] [--frame-id <id>] [--capture-console] [--max-console <n>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target wait <targetId> (--for-text <text> | --for-selector <query> | --network-idle) [--frame-scope <scope>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target url-assert <targetId> [--host <host>] [--origin <origin>] [--path-prefix <prefix>] [--url-prefix <prefix>] [--timeout-ms <ms>] [--no-persist] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target console-tail <targetId> [--capture-ms <ms>] [--max-events <n>] [--levels <csv>] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target health <targetId> [--timeout-ms <ms>] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target hud <targetId> [--timeout-ms <ms>] [--fields <csv>] [--no-json] [--pretty] [--session <id>]
surfwright target network <targetId> [--action-id <id>] [--profile <preset>] [--view <mode>] [--fields <csv>] [--capture-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--include-headers] [--include-post-data] [--no-ws-messages] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target network-tail <targetId> [--action-id <id>] [--profile <preset>] [--capture-ms <ms>] [--max-ws-messages <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target network-query [--capture-id <id> | --artifact-id <id>] [--preset <name>] [--limit <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--no-json] [--pretty]
surfwright target network-begin <targetId> [--action-id <id>] [--profile <preset>] [--max-runtime-ms <ms>] [--max-requests <n>] [--max-websockets <n>] [--max-ws-messages <n>] [--include-headers] [--include-post-data] [--no-ws-messages] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target network-end <captureId> [--profile <preset>] [--view <mode>] [--fields <csv>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--timeout-ms <ms>] [--no-json] [--pretty]
surfwright target network-export <targetId> --out <path> [--action-id <id>] [--format har] [--profile <preset>] [--capture-ms <ms>] [--max-requests <n>] [--url-contains <text>] [--method <verb>] [--resource-type <type>] [--status <code|class>] [--failed-only] [--reload] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target network-export-list [--limit <n>] [--no-json] [--pretty]
surfwright target network-export-prune [--max-age-hours <h>] [--max-count <n>] [--max-total-mb <n>] [--keep-files] [--no-json] [--pretty]
surfwright target network-check [targetId] --budget <path> [--capture-id <id>] [--artifact-id <id>] [--profile <preset>] [--capture-ms <ms>] [--fail-on-violation] [--timeout-ms <ms>] [--no-json] [--pretty] [--session <id>]
surfwright target prune [--max-age-hours <h>] [--max-per-session <n>] [--no-json] [--pretty]
surfwright state reconcile [--timeout-ms <ms>] [--max-age-hours <h>] [--max-per-session <n>] [--drop-managed-unreachable] [--no-json] [--pretty]
```

Default command execution uses a local daemon path for lower warm-start overhead.
Set `SURFWRIGHT_DAEMON=off` to force direct per-invocation execution.
Use `--agent-id <id>` (or `SURFWRIGHT_AGENT_ID`) to isolate state+daemon scope per agent.

Machine-readable runtime contract:

```bash
surfwright contract
```

Default workflow for agent loops:

```bash
surfwright open https://example.com
surfwright target frames <targetId>
surfwright target snapshot <targetId>
surfwright target find <targetId> --selector a --contains "Checkout" --first --visible-only
surfwright target click <targetId> --text "Blog" --visible-only
surfwright target read <targetId> --selector main --frame-scope main --chunk-size 1200 --chunk 1
surfwright target extract <targetId> --kind blog --frame-scope all --limit 10
surfwright target eval <targetId> --expr "console.log('hello from agent'), document.title" --capture-console
surfwright target wait <targetId> --for-selector "h1"
surfwright target url-assert <targetId> --host example.com --path-prefix /
surfwright target console-tail <targetId> --capture-ms 2000 --levels error,warn
surfwright target health <targetId>
surfwright target hud <targetId>
surfwright target network <targetId> --profile perf --view summary
surfwright target network-tail <targetId> --profile api --capture-ms 3000
surfwright target network-query --capture-id <captureId> --preset slowest --limit 10
surfwright target network <targetId> --view table --fields id,method,status,durationMs,url
surfwright target network-begin <targetId> --action-id checkout-click --profile api --max-runtime-ms 600000
surfwright target network-end <captureId> --view summary --status 5xx
surfwright target network-export <targetId> --profile page --reload --capture-ms 3000 --out ./artifacts/capture.har
surfwright target network-export-list --limit 20
surfwright target network-export-prune --max-age-hours 72 --max-count 100 --max-total-mb 256
surfwright target network-check <targetId> --budget ./budgets/network.json --profile perf --capture-ms 5000 --fail-on-violation
```

Plan UX examples:

```bash
surfwright run --doctor --plan-json '{"steps":[{"id":"open","url":"https://example.com"},{"id":"snapshot"}]}'
surfwright run --plan ./plan.json --record --record-label smoke
surfwright run --replay ~/.surfwright/runs/2026-02-13Z-smoke-abc123.json
```

Session selection defaults:

- `open` (without `--session`) creates a new isolated ephemeral managed session.
- `run` (without `--session`) starts a new isolated session and keeps it across plan steps.
- `target *` (without `--session`) infers the session from persisted `targetId` mapping.
- `target list` requires `--session` when no `targetId` is available to infer session.
- set `--isolation shared` on `open`/`run` to reuse the managed shared-session path instead.

Headless vs headed (managed sessions):

- Defaults remain `headless`.
- Use `--browser-mode headed` on `session ensure/new/fresh`, `open`, or `run` when you need a visible browser window.
- SurfWright reports `browserMode` in `session` and `open` JSON outputs (attached sessions report `unknown`).

Human login handoff (GitHub example):

```bash
surfwright session new --session-id s-login --browser-mode headed
surfwright --session s-login open https://github.com/login

# Human: finish login in the headed browser window, then continue the agent loop.
surfwright target snapshot <targetId>
```

State hygiene workflow for stale local metadata:

```bash
surfwright session prune
surfwright session clear
surfwright target prune --max-age-hours 168 --max-per-session 200
surfwright state reconcile
```

- `session prune` removes unreachable attached sessions and repairs stale managed `browserPid`.
- `session clear` clears all sessions/targets and shuts down associated browser processes by default (`--keep-processes` to opt out).
- `target prune` removes orphaned/aged targets and caps retained targets per session.
- `state reconcile` runs both in one pass (recommended after host/browser restarts).

`open` intentionally returns a minimal success shape for agent loops (including redirect evidence fields):

```json
{"ok":true,"sessionId":"s-1","sessionSource":"implicit-new","browserMode":"headless","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2p8-1sz7jc","requestedUrl":"http://camelpay.localhost/","finalUrl":"http://camelpay.localhost/","wasRedirected":false,"redirectChain":null,"redirectChainTruncated":false,"url":"http://camelpay.localhost/","status":200,"title":"CamelPay — Cross-chain crypto checkout","timingMs":{"total":231,"resolveSession":4,"connectCdp":33,"action":176,"persistState":18}}
```

`target snapshot` returns bounded page-read primitives for deterministic agent parsing:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","mode":"snapshot","cursor":null,"nextCursor":null,"url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","scope":{"selector":null,"matched":true,"visibleOnly":false,"frameScope":"main"},"textPreview":"CamelPay is in early access ...","headings":["Cross-chain crypto checkout, made simple"],"buttons":["Start Checkout"],"links":[{"text":"Read the docs","href":"http://localhost:3002/developers/quickstart"}],"truncated":{"text":false,"headings":false,"buttons":false,"links":false},"hints":[],"timingMs":{"total":147,"resolveSession":4,"connectCdp":26,"action":104,"persistState":13}}
```

Use `--max-... 0` to omit a category. If `nextCursor` is non-null, pass it back via `--cursor` to page through large inventories with stable ordering.

Use `--include-selector-hints` to include bounded `items.*.selectorHint` rows. Use `--mode orient` for a quiet first-load payload (returns `h1` and limits `links` to header/nav links; defaults `--max-buttons 0`).

`target find` returns bounded match records for text/selector queries:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","mode":"text","query":"Checkout","count":9,"limit":5,"matches":[{"index":0,"text":"Cross-chain crypto checkout, made simple","visible":true,"selectorHint":"h1"}],"truncated":true,"timingMs":{"total":132,"resolveSession":3,"connectCdp":24,"action":92,"persistState":13}}
```

`target click` executes one click and returns action metadata:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2pc-9kd2rj","mode":"selector","selector":"#start-checkout","contains":null,"visibleOnly":true,"query":"#start-checkout","matchCount":1,"pickedIndex":0,"clicked":{"index":0,"text":"Start Checkout","visible":true,"selectorHint":"a#start-checkout.inline-flex.h-9"},"url":"http://camelpay.localhost/#checkout","title":"CamelPay — Cross-chain crypto checkout","wait":null,"snapshot":null,"timingMs":{"total":128,"resolveSession":4,"connectCdp":25,"action":84,"persistState":15}}
```

Use `--index <n>` (0-based) to click the Nth match. Use `--explain` to return bounded match-selection evidence and rejection reasons without performing the click.

Use `--delta` to include a bounded, evidence-based before/after payload (no semantic UI claims). v0 includes URL/title, focus evidence, and role-count deltas for `dialog|alert|status|menu|listbox`, plus a fixed list of ARIA attribute values captured on the clicked element.

`target read` returns deterministic text chunks for long pages:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","url":"http://camelpay.localhost/","title":"CamelPay — Cross-chain crypto checkout","scope":{"selector":"main","matched":true,"visibleOnly":true},"chunkSize":1200,"chunkIndex":1,"totalChunks":2,"totalChars":2200,"text":"Cross-chain crypto checkout, made simple ...","truncated":true,"timingMs":{"total":139,"resolveSession":4,"connectCdp":27,"action":95,"persistState":13}}
```

`target eval` executes bounded page-context JavaScript for one explicit target:

```json
{"ok":true,"sessionId":"s-1","sessionSource":"target-inferred","targetId":"1764200ABD63A830C21F4BF2799536D0","actionId":"a-m6m2pk-1xk9","expression":"console.log('hello from agent'), document.title","context":{"frameCount":1,"evaluatedFrameId":"f-0","evaluatedFrameUrl":"http://camelpay.localhost/","sameOrigin":true,"world":"main"},"result":{"type":"string","value":"CamelPay — Cross-chain crypto checkout","truncated":false},"console":{"captured":true,"count":1,"truncated":false,"entries":[{"level":"log","text":"hello from agent"}]},"timingMs":{"total":126,"resolveSession":4,"connectCdp":25,"action":84,"persistState":13}}
```

Use `--expr` when you want the value of an expression without writing an explicit `return`. Use `target frames` to enumerate `frameId` handles and pass `--frame-id` when evaluating inside an iframe; `target eval` reports compact `context` metadata to clarify what was actually evaluated.

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

Output is JSON by default and compact (one line for easy piping). Add `--pretty` only when a human needs multiline output. Use `--no-json` for human-friendly summaries.

Sessions are tracked in state with an explicit active pointer:

- default: `~/.surfwright/state.json`
- agent-scoped: set `SURFWRIGHT_AGENT_ID=<agentId>` to use `~/.surfwright/agents/<agentId>/state.json`
- explicit override: `SURFWRIGHT_STATE_DIR=<path>`

Project workspaces are separate from state. A workspace stores reusable browser profiles for authenticated flows under `./.surfwright/` (gitignored by `workspace init`):

```bash
surfwright workspace init
surfwright open https://github.com/login --profile auth --browser-mode headed
```

Future runs (even from a different agent) can reuse the same logged-in state:

```bash
surfwright open https://github.com --profile auth
```

Workspace override:

- CLI: `--workspace <dir>`
- env: `SURFWRIGHT_WORKSPACE_DIR=<path>`

`session ensure` still runs a built-in hygiene pass, but command defaults are now isolation-first:
- `open`/`run` without `--session` use new ephemeral sessions by default.
- `target *` without `--session` infer from persisted `targetId`.
- explicit `--session` always wins and is validated against `targetId` ownership.
For authenticated workflows across sessions, use `session cookie-copy` with one or more `--url` scopes (for example `dashboard` + `access` domains) to transfer cookie state without dumping cookie values to stdout.
Set `SURFWRIGHT_SESSION_LEASE_TTL_MS=<ms>` to tune session lease retention (default 72h).
Use `session new --policy persistent` for long-lived sessions and `--policy ephemeral` for disposable runs.

Guardrail: SurfWright never auto-attaches to arbitrary running browsers. Attaching to an existing browser only happens via explicit `session attach --cdp ...`.

If the endpoint is slow to answer `/json/version`, increase attach reachability window with `--timeout-ms <ms>`.

Contract ids are executable aliases. Example: `surfwright target.find <targetId> --text Checkout`.

## Update Behavior

Runtime update interface is policy-first and JSON-first:

- `surfwright update check`
- `surfwright update run`

Channels:

- `stable` -> npm dist-tag `latest`
- `beta` -> npm dist-tag `next`
- `dev` -> reserved, disabled until explicitly enabled

Policy defaults:

- local/operator default: `manual`
- CI/production-agent default: `pinned`

Update flows must support rollback and must never apply silent background updates by default.

## Skills Compatibility

Skill lifecycle compatibility is contract-gated:

- `requires.surfwrightVersion`
- `contractSchemaVersion`
- `contractFingerprint`

Skill runtime interface:

- `surfwright skill install`
- `surfwright skill update`
- `surfwright skill doctor`

Lock file:

- `skills/surfwright.lock.json` records pinned install metadata for deterministic CI/agent runs.

## Agent Guidance In Repo

- Architecture map (short): `ARCHITECTURE.md`
- Architecture deep dives (index): `docs/architecture.md`
- Agent boundary rules (compat shim): `docs/agent-guidance-architecture.md`
- Maintenance checklist: `docs/maintaining-agent-surface.md`
- Release/update policy source of truth: `docs/release-governance.md`
- Contributor release/doc routing: `docs/contributor-release-routing.md`
- Update lifecycle details: `docs/lifecycle/update-lifecycle.md`
- Skill lifecycle details: `docs/skills-lifecycle.md`
- Zero-context evaluation workflow (ZCL is external): `docs/zerocontext-lab.md`
- Installable runtime skill: `skills/surfwright/SKILL.md`

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
