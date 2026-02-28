# Changelog

All notable changes to SurfWright are documented here.

## [Unreleased]

### Added
- [daemon] Added lane-based daemon scheduler defaults with explicit backpressure contracts (`laneConcurrency=1`, `globalActiveLanes=8`, `laneQueueDepth=8`, `queueWaitMs=2000`) and typed queue failure routing (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`).
- [daemon] Added shared runtime access + runtime pool state machine (`absent|warming|ready|degraded|draining|closed`) with contract coverage for no-double-warm, timeout recycle, repeated-timeout hard-close, and session mismatch fail-closed behavior.
- [daemon] Added local diagnostics sink files (`diagnostics/daemon.ndjson`, `diagnostics/daemon.metrics.ndjson`) with default-off verbose gating (`SURFWRIGHT_DEBUG_LOGS=1`) and required daemon metric emission.
- [daemon] Added metadata hardening enforcement for daemon state (`0600` permission + ownership validation on POSIX) with rejection+cleanup coverage for weak metadata.
- [bench] Added direct CLI benchmark artifact set for daemon-on workloads `W1`, `W4`, `W6` with per-attempt elapsed/code/queue/RSS captures under `tmp/daemon-concept/artifacts/`.
- [open] Added `open --wait-until <commit|domcontentloaded|load|networkidle>` and additive output fields `waitUntil`, `reuseMode`, `reusedTarget` for explicit navigation/readiness evidence.
- [open] Added `open --reuse <off|url|origin|active>` for explicit tab-reuse policy.
- [target] Added `target style` for first-class computed-style inspection without `target eval` scripting.
- [target] Added `target attr` for deterministic attribute reads from matched elements (`--index|--nth`) with absolute URL normalization for URL-like attributes (`href`, `src`, `action`, ...).
- [target] Added `target click --proof` to emit a compact one-shot evidence payload (implies `--snapshot` + `--delta`).
- [target] Added `target click --repeat <n>` (1-25) to execute repeated deterministic clicks in one command, returning final click fields plus additive `repeat` metadata (`requested`, `completed`, `actionIds`, `pickedIndices`).
- [target] Added additive `target click --proof.countAfter` for selector-mode clicks (post-action selector cardinality when available).
- [target] Added `target click --nth <n>` (1-based) as an explicit disambiguation alias over `--index`.
- [target] Added `target click --count-after` and `--expect-count-after <n>` for typed post-click selector-count evidence/assertions without requiring full proof payloads.
- [target] Added `target extract --include-actionable` with per-item actionable metadata (`handle`, `selectorHint`, `frameId`, `href`) for deterministic extract-to-action chaining.
- [target] Added `target extract --kind docs-commands` with command-oriented fields (`command`, `language`, `section`) for docs/codeblock extraction.
- [target] Added `target extract --kind command-lines` for normalized runnable command-line entries from docs/code blocks.
- [target] Added `--wait-timeout-ms <ms>` to `target click` and `target wait` so wait-stage budgets are explicit and independent from command timeout.
- [target] Added additive `target find` per-match metadata fields: `href` (nearest actionable anchor URL when present) and `tag` (matched element tag).
- [target] Added `target find` link-destination narrowing flags: `--href-host <host>` and `--href-path-prefix <prefix>` with echoed filter fields in the report.
- [target] Added additive `target click.handoff` metadata (`sameTarget`, `openedTargetId`, `openedUrl`, `openedTitle`) for deterministic post-click target chaining.
- [contract] Added additive `contract.guidance[]` with command signatures, runnable examples, and proof schema hints for high-traffic flows.
- [contract] Added `contract --search <term>` for low-token focused contract introspection.
- [contract] Added `contract --core` for low-token bootstrap payloads (focused command/error/guidance subset).
- [contract] Added `contract --command <id>` for compact per-command lookup (`flags`, `positionals`, `examples`, canonical invocation) to reduce full-contract probing in agent loops.
- [errors] Added `E_HANDLE_TYPE_MISMATCH` for explicit `sessionId`/`targetId` swap detection with typed recovery payloads.
- [errors] Added additive `recovery` metadata on typed failures when deterministic next-command routing is available.
- [cli] Added global `--output-shape <full|compact|proof>` (and `SURFWRIGHT_OUTPUT_SHAPE`) to project JSON outputs without changing command semantics.
- [target] Added `--proof` support to `target fill`, `target keypress`, `target upload`, `target drag-drop`, and `target dialog` with a shared compact evidence shape.
- [actions] Added post-action assertions (`--assert-url-prefix`, `--assert-selector`, `--assert-text`) and additive `proofEnvelope` support across `open`, `target click`, `target fill`, `target keypress`, `target upload`, `target drag-drop`, `target dialog`, `target download`, and `target wait`.
- [target] Added extraction kinds `headings`, `links`, `codeblocks`, `forms`, and `tables` to `target extract` for broader no-eval structured reads.
- [target] Added `target style --kind <button-primary|input-text|link-primary>` preset shortcuts for common style validation flows.
- [target] Added `target fill --event-mode <minimal|realistic|none>` and `target fill --events <csv>` for deterministic post-fill event dispatch (including keyup-sensitive UI flows).
- [target] Added `target click --within <selector>` to scope text/selector matching for dense pages and reduce ambiguous click selection.
- [target] Added `target extract --kind table-rows` with optional schema mapping (`--schema-json|--schema-file`) and deterministic record dedupe (`--dedupe-by`) to reduce `target eval` dependence.
- [open] Added additive navigation classification field `blockType` (`auth|captcha|consent|unknown`) to `open` reports.
- [target] Added additive `blockType` classification to `target url-assert` reports for auth/captcha/consent-aware URL assertions.
- [run] Added `run` plan-step support for `fill` and `upload` so multi-step plans can execute full form workflows without eval glue.
- [run] Added `run` plan-step support for bounded `repeat-until` loops (`step`, `untilPath`, one condition, `maxAttempts`) to replace ad-hoc shell retry loops.
- [run] Added `repeat-until.untilDeltaGte` condition for bounded "progress delta" completion checks between attempts.
- [run] Added top-level `run` plan `result` projection map (`outputField -> sourcePath`) for direct mission-field extraction from step aliases without post-run `jq` glue.
- [run] Added top-level `run` plan `require` assertions (`equals|contains|gte|truthy|exists`) for deterministic final-output correctness gates.
- [target] Added `target click-read` as a composed primitive to click and then read bounded text in one deterministic command.
- [target] Added `target extract --summary` for compact summary/proof fields (`itemCount`, `totalRawCount`, `firstTitle`, `firstUrl`, `firstCommand`, `source`).
- [open] Added `open --ensure-session <off|if-missing|fresh>` to let `open` bootstrap or fork managed sessions without separate `session` orchestration.
- [target] Added orient count controls to `target snapshot`: `--count-scope <full|bounded>` and `--count-filter <headings,buttons,links,nav>`.
- [target] Added `target download --allow-missing-download-event` for deterministic non-started result envelopes when browser download events are suppressed.
- [target] Added `target download --fallback-to-fetch` to capture artifacts deterministically when browser download events are missed.
- [run] Added `run` plan-step support for `click-read`/`clickRead` (composed click then bounded read).
- [run] Added `run` plan-step support for `count`.
- [target] Added `target upload --submit-selector <query>` for atomic attach+submit upload flows.
- [target] Added upload result-verification controls: `target upload --wait-for-result`, `--result-selector`, `--result-text-contains`, and `--result-filename-regex` for deterministic post-upload confirmation in one action.
- [target] Added `target select-option` for first-class native `<select>` control (`--value|--label|--option-index`) with deterministic selected proof fields.
- [target] Added `target click --proof-check-state` for checkbox/radio proof deltas (`proof.checkState.before/after/changed`).
- [target] Added `target spawn --proof --assert-title <text>` for compact spawn evidence and title assertion in new-window flows.
- [target] Added `target scroll-plan --mode <absolute|relative>` for deterministic absolute-position or relative-delta scroll execution in one command.
- [target] Added `target count --count-only` for compact `{ok,count}` output mode in low-token loops.
- [state] Added `state disk-prune` for bounded cleanup of run artifacts, capture artifacts, and orphan profile storage (`--dry-run` supported; workspace profile pruning opt-in).
- [docs] Added a versioned native ZCL browser-control campaign package (`docs/campaigns/browser-control-native-codex.yaml` + `docs/campaigns/browser-control-zcl-native.md`) for repeatable feedback runs.
- [docs] Pinned the native browser-control ZCL campaign to `runner.model=gpt-5.3-codex-spark` with `runner.modelReasoningEffort=medium` and `runner.modelReasoningPolicy=best_effort`.
- [zcl] Added browser-control exam-mode asset tooling: `scripts/zcl/build-browser-control-exam-pack.mjs` (split prompt/oracle generation) and `scripts/zcl/eval-browser-control-oracle.mjs` (host-side oracle evaluator).
- [zcl] Added generated browser-control prompt set (`missions/browser-control/prompts/*.md`) and oracle set (`missions/browser-control/oracles/*.json`) for versioned mission IDs.
- [bench] Added SurfWright benchmark loop assets: `bench/agent-loop/config.json`, `bench/agent-loop/AGENT_LOOP.md`, and non-versioned per-scope outputs under `tmp/zerocontext/bench-loop/scopes/<scopeId>/` (`history.jsonl`, `RESULT_SHEET.md`, `RESULT_SHEET.json`, `NEXT_ITERATION_TASK.md`).
- [bench] Added `scripts/bench/run-iteration.mjs` to run pinned SurfWright-only ZCL campaign iterations end-to-end (preflight, lint, doctor, run, report, score, history append).
- [bench] Added `scripts/bench/score-iteration.mjs` for raw attempt/trace extraction (mission metrics, exec/MCP counts, subcommand frequency, slow command hotspots).
- [bench] Added `scripts/bench/summarize-history.mjs` to convert scope-ledger data into result sheets and next-iteration briefs.
- [cli] Added npm scripts `bench:loop:run`, `bench:loop:score`, and `bench:loop:history`.

### Changed
- [daemon] Queue-pressure typed failures (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) now carry additive recovery fields (`retryable`, `phase`, `recovery`, `hints`, `hintContext`) through daemon transport to CLI output.
- [daemon] Queue-pressure runtime messages now align with contract wording (`Daemon queue wait budget expired before dispatch`, `Daemon lane queue depth cap reached; request rejected`).
- [cli] `help` now normalizes dot-path and multi-token command paths to canonical help execution (for example `help target.dialog` -> `target dialog --help`).
- [cli] `contract --search` now tolerates unquoted multi-token terms by normalizing trailing bare tokens into one search term.
- [state] State read/version failures now return typed failures and quarantine the offending `state.json` snapshot instead of silently resetting to empty state.
- [errors] Added typed state read failure codes `E_STATE_READ_INVALID`, `E_STATE_VERSION_MISMATCH`, and `E_STATE_READ_FAILED` to the published contract error surface.
- [daemon] CLI daemon proxy now normalizes non-contract daemon-internal typed failures to `E_INTERNAL`; queue pressure codes remain pass-through.
- [daemon] Daemon run transport now supports chunked response frames (`run_chunk`/`run_end`) with deterministic client-side reassembly for large outputs.
- [session] `session ensure` no longer performs global prune as part of the hot path; cleanup stays in explicit maintenance flows.
- [cli] Daemon bypass routing now derives bypassable command IDs from the command manifest set (plus explicit stdin-plan/internal/help guards) instead of pure argv-branch hardcoding.
- [extensions] `extension.*` commands now honor global `--no-json` with deterministic human summaries.
- [session] `session clear` now supports scoped teardown via `--session <id>`, clearing only the selected session and its related target/network metadata while preserving other sessions.
- [target] `target click` wait payload now includes bounded telemetry (`timeoutMs`, `elapsedMs`, `satisfied`) for post-click wait stages.
- [target] `target eval --help` now surfaces typed alternatives (`target extract`, `target style`, `target read`) plus compact-output usage for lower-token operator loops.
- [target] `target eval` now accepts base64 script inputs via `--expr-b64` and `--script-b64` to reduce shell-quoting overhead in agent loops.
- [target] `target eval` now validates JavaScript syntax before session/browser resolution to fail fast with typed query errors.
- [target] `target wait` now includes a structured `wait` payload (`mode`, `value`, `timeoutMs`, `elapsedMs`, `satisfied`) while keeping existing top-level `mode`/`value`.
- [target] `target snapshot --mode orient|snapshot` now includes additive aggregate counters (`headingsCount`, `buttonsCount`, `linksCount`), plus `navCount` for orient mode.
- [errors] Typed failures can now include optional bounded `hints` and `hintContext` fields (additive; `code` + `message` contract preserved).
- [errors] Commander-originated `E_QUERY_INVALID` failures now include additive machine-fix diagnostics (`unknownFlags`, `expectedPositionals`, `validFlags`, `canonicalInvocation`) for deterministic recovery.
- [contract] `contract --command` now accepts CLI path lookup forms (for example `target snapshot`) and tolerates extra mode/search flags while still returning `mode=command`.
- [contract] Per-command contract output now includes additive machine-invocation fields (`argvPath`, `dotAlias`) for deterministic command execution.
- [cli] Improved first-run discoverability: parse errors now show stronger suggestions/help.
- [target] Unified post-action waits across interactive actions: `target fill|keypress|upload|drag-drop|dialog` now support `--wait-for-text|--wait-for-selector|--wait-network-idle` and `--wait-timeout-ms`.
- [session] Reduced repeat command overhead in tight loops with short-lived CDP reachability caching during session health checks.
- [session] Added opportunistic idle managed-process parking on command ingress (detached worker, bounded sweep) to prevent Chrome accumulation without introducing a persistent daemon.
- [state] Opportunistic maintenance now also prunes stale disk artifacts (`runs`, `captures`, orphan `profiles`) with conservative retention caps; workspace profile pruning remains explicit opt-in.
- [state] Session lifecycle maintenance (`session prune`, `session clear`) now runs external reachability/process shutdown work outside the state-file lock and commits state mutations in short lock windows.
- [state] Replaced monolithic `state.json` as runtime source-of-truth with canonical `state-v2/` shards (`meta`, `sessions`, `network-captures`, `network-artifacts`, and per-session target shards) so hot-path mutations only rewrite changed shards.
- [state] Added optimistic revisioned mutation commits for `state-v2` so default mutation work runs outside the lock and lock scope is limited to short compare-and-commit windows.
- [target] Target handle resolution now uses a per-browser targetId cache with closed-page eviction and scan fallback on cache miss.
- [session] Managed session creation paths now reserve session handles first and perform browser startup outside state mutation locks before a short commit step.
- [daemon] Daemon bootstrap now uses a startup singleflight lock to avoid parallel spawn/meta races when multiple commands cold-start concurrently.
- [daemon] Daemon lane resolution now recognizes `--session-id` as a session lane key and partitions control-lane traffic by hashed `--agent-id` when provided (falls back to `control:default` when absent).
- [daemon] Validation now includes executable daemon changeset gates: contract snapshot diffs require approval-log updates, and daemon behavior edits require docs+tests in the same change set.
- [state] `state reconcile` now includes daemon hygiene counters (`scanned/kept/removed`, reason breakdowns, stale lock counts), and opportunistic maintenance now sweeps stale daemon metadata/start locks.
- [session] `session attach --cdp` now accepts `ws://`/`wss://` endpoints and supports HTTP(S) discovery URLs with path/query (resolved to websocket endpoints for runtime attach).
- [session] CDP attach health checks now split discovery and websocket-connect stages for clearer remote endpoint handling under variable latency.
- [browser] Managed Chrome launch now applies Linux container resilience flag `--disable-dev-shm-usage` to reduce startup flakes in constrained environments.
- [target] `target download` payload now uses canonical nested proof fields (`fileName`, `bytes`) plus additive top-level projection fields (`downloadStarted`, `downloadStatus`, `downloadFinalUrl`, `downloadFileName`, `downloadBytes`).
- [target] `target download` payload now includes additive capture provenance/alias fields (`downloadMethod`, `downloadedFilename`, `downloadedBytes`) across event, fetch-fallback, and non-started envelopes.
- [docs] Runtime skill/workflow guidance no longer prescribes manual `session clear` cleanup in the default agent loop; guidance now favors opportunistic runtime maintenance plus explicit maintainer-only state maintenance commands.
- [errors] `target click` mismatch failures now include stronger disambiguation context (`withinSelector`, bounded candidate sample) for faster recovery without blind retries.
- [run] Pipeline step execution is now table-driven to keep step parsing/dispatch behavior centralized and reduce drift risk as steps are added.
- [run] `run` click-step support now forwards deterministic click controls (`within`, `frameScope`, `index|nth`, wait budget, proof/delta/count-after/assert fields) instead of dropping them.
- [run] Upload plan steps now forward upload action fields `submitSelector`, `expectUploadedFilename`, and result-verification controls (`waitForResult`, `resultSelector`, `resultTextContains`, `resultFilenameRegex`) instead of dropping them.
- [run] `run --doctor` now reports `requireChecks` to expose final-plan assertion coverage.
- [target] `target style` now emits a compact additive `proof` payload so `--output-shape proof` is directly actionable without extra parsing.
- [target] `target style --proof` now includes mission-friendly compact fields (`found`, `targetText`, `styleBg`, `styleColor`, `styleFontSize`, `styleRadius`).
- [target] `target extract --summary` now includes a `count` alias (same value as `totalRawCount`) for simpler success checks.
- [target] `target extract --output-shape proof` now derives compact proof fields from extracted records without requiring `--summary`.
- [target] `target eval --output-shape proof` now consistently projects compact `proof.resultType` and `proof.resultValue` fields.
- [cli] JSON output remains default and still accepts explicit `--json`.
- [zcl] Switched the versioned browser-control campaign to `promptMode=exam` with split mission sources (`promptSource` + `oracleSource`) and `evaluation.mode=oracle` via normalized built-in rules.
- [zcl] Oracle evaluator now accepts common equivalent encodings for strict mission values (for example URL trailing slash differences, `6` vs `6px`, shell prompt prefixes, and comma-list vs array representations).
- [skill] Reduced the SurfWright runtime skill surface to a single bootstrap file (`skills/surfwright/SKILL.md`) and moved non-runtime guidance to maintainer docs.
- [bench] Reworked benchmark execution to one-campaign-per-scope semantics with explicit `--mission-id` / `--mission-ids`, per-scope history isolation, and fresh-agent enforcement per attempt.
- [bench] `bench:loop:run` now supports explicit iteration modes (`--mode optimize|sample`, `--sample`) and defaults to optimize semantics (`change -> run -> evaluate`).
- [bench] `bench:loop:run` now supports configurable per-mission parallel fan-out via `agentsPerMission` (config) and `--agents-per-mission` (CLI), generating parallel SurfWright flow shards within one campaign run.
- [bench] Tightened benchmark headless guard wiring: campaign shim now hard-fails `--browser-mode headed` before launch, and guard metrics count only successful headed executions.
- [bench] Reworked history summarization into per-scope result sheets (`tmp/zerocontext/bench-loop/scopes/<scopeId>/RESULT_SHEET.*`) focused on change intent, outcome, and evidence deltas.
- [bench] Removed `bench:loop:run --reset-history`; scope ledgers are append-only by default.
- [bench] `bench:loop:score` now supports flow-family aggregation (`--flow-prefix`) so sharded SurfWright fan-out runs are scored as one iteration, with per-attempt `flowId`/slot evidence in CSV/markdown outputs.
- [bench] Documented branch-first loop policy: run optimize iterations on feature branches with commit-per-change traceability, and push only when explicitly requested.
- [missions] Updated browser-control campaign selection to 16 active missions, revised `first-pass-orientation`, `style-inspection`, `checkbox-toggle`, `iframe-edit`, and `docs-commands-extract`, and archived prior mission definitions.

### Fixed
- [cli] JSON-mode Commander parse failures now remain pure typed JSON (no appended help/prose), reducing token noise and parser ambiguity for agents.
- [cli] Timeout parser validation failures now return typed `E_QUERY_INVALID` instead of collapsing to `E_INTERNAL`.
- [tests] Browser target-effects contract tests no longer mask first-attempt failures via broad retry classes.
- [tests] Split daemon queue routing contract assertions into focused files to stay within LOC policy and keep review scope bounded.
- [target] Session resolution for target-driven actions now attempts active/single-session recovery when target-to-session mappings are stale, reducing `E_TARGET_SESSION_UNKNOWN`/`E_SESSION_NOT_FOUND` churn in long runs.
- [open] `open --reuse active` now reuses the current tab only for same-origin navigations (or blank tabs), avoiding unintended cross-site tab drift.
- [cli] Commander parse failures for `session clear` now include focused remediation hints for scoped cleanup and keep-processes boolean syntax.
- [target] `target click` query-mismatch failures now return bounded remediation hints and context for `E_QUERY_INVALID` paths to reduce blind retry loops.
- [errors] `E_BROWSER_START_FAILED`, `E_BROWSER_START_TIMEOUT`, `E_STATE_LOCK_IO`, and `E_STATE_LOCK_TIMEOUT` now include bounded hints/hintContext for faster operator triage.
- [target] Stale `targetId` errors now include stronger replacement-target hints and hint context to speed recovery in concurrent session flows.
- [target] Upload wait-stage timeout failures now return typed `E_WAIT_TIMEOUT` instead of leaking as `E_INTERNAL` when wait conditions are not satisfied in time.
- [target] Download event wait timeouts now return typed `E_DOWNLOAD_TIMEOUT` (with `retryable=true` and `phase=download_event_wait`) instead of generic `E_INTERNAL`.
- [cli] Commander unknown-option failures for `contract` now include focused alternatives for `--search` and `--full` to reduce cold-start option probing loops.
- [browser] Managed startup retry wait-plan is now explicitly exported/tested to guard first-attempt and retry envelopes against regression.
- [cli] Commander parse failures now map to typed JSON `E_QUERY_INVALID` responses (with bounded hints/hintContext) in JSON mode.
- [target] `target eval` timeout handling now performs best-effort CDP termination/stop-loading recovery so follow-up commands remain stable after `E_EVAL_TIMEOUT`.
- [session] `session attach` unreachable failures now redact sensitive CDP query credentials in error text.
- [errors] `E_SESSION_NOT_FOUND` and `E_TARGET_SESSION_UNKNOWN` now include bounded continuity hints/hintContext for faster recovery after stale session/target mappings.
- [state] State lock stale detection now checks lock-owner PID liveness and lock timeouts now emit additive lock diagnostics (`waitMs`, `lockOwnerPid`, `lockOwnerAlive`, `stateRoot`).
- [browser] Managed startup timeout recovery now performs bounded TERM->KILL shutdown verification before retrying, reducing leaked Chrome process/profile races.
- [daemon] Idle shutdown now forcibly clears half-open idle sockets so daemon workers exit cleanly instead of lingering after `server.close()` with stale connections.
- [daemon] CLI daemon proxy now retries queue-pressure typed failures (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`) with a short bounded backoff before returning the typed error.
- [daemon] CLI `--help`/`-h` invocations now bypass daemon proxying so help output remains available under daemon queue contention.
- [daemon] `contract` commands now bypass daemon proxying to reduce control-lane contention from low-cost metadata lookups.
- [daemon] `open <url>` lane routing now derives `origin:url:<hash>` lanes when session/profile/shared-origin hints are absent, reducing control-lane contention under parallel open flows.
- [daemon] Daemon proxy now injects request-scoped `SURFWRIGHT_AGENT_ID` into daemon argv when `--agent-id` is omitted, preserving per-agent lane partitioning in parallel runs.
- [daemon] Daemon-run command failures now preserve typed CLI envelopes (for example `E_QUERY_INVALID`) instead of collapsing to generic `E_DAEMON_RUN_FAILED` for validation errors.
- [browser] Managed session startup now performs scoped profile startup-artifact cleanup before the single bounded retry after `E_BROWSER_START_TIMEOUT` (no timeout inflation).
- [run] Fixed deterministic plan template resolution for object payloads by removing duplicate nested assignment in `resolveTemplateInValue`.
- [state] Hardened `sessionId`/`targetId` sanitization to reject placeholder handles (`undefined`, `null`, `nan`) early.
- [target] `target download` now waits for `domcontentloaded` before click query evaluation to reduce commit-stage race misses after `open --allow-download`.
- [bench] Prevented optimize-loop misuse by rejecting no-change optimize runs when there is no detectable change since the previous iteration (unless `--allow-no-change` is set, or `--mode sample` is used).

### Transition Notes
- None.

### Removed
- [docs] Removed campaign planning docs under `docs/campaigns/`.
- [target] Removed old download aliases `download.filename` and `download.size`; use canonical `download.fileName` and `download.bytes`.
- [open] Removed `open --reuse-url`; use `open --reuse url`.
- [cli] Removed `contract --compact`; compact remains the default `contract` output mode.
- [cli] Removed argv compatibility rewrites for `target <subcommand> --target <id>` and wrapper `session clear` forms; canonical argv is now enforced.
- [state] Removed `SURFWRIGHT_STATE_LEGACY_SNAPSHOT`; runtime writes canonical `state-v2` storage only.
- [target] Removed `target eval` option aliases `--js` and `--script`; use `--expr|--expression|--script-file`.
- [target] Removed `target style` output aliases `element` and `computed`; use `inspected` and `values`.
- [target] Removed `target spawn` output alias `childTargetId`; use canonical `targetId`.
- [state] Removed state schema migration layer.
- [skill] Removed `skills/surfwright/references/*`; runtime agent guidance now lives only in `skills/surfwright/SKILL.md`.

## [0.1.2] - 2026-02-17


### Added
- [distribution] Added generated `skills-dist` branch and `skills-v*` tags for lightweight, pinned installs via the `skills` CLI (skills.sh ecosystem).
- [release] Added `publish-dry-run.yml` to exercise publish-path checks before tag-based release.
- [test] Added coverage for `scripts/release/release-notes-from-changelog.mjs` failure/success behavior.
- [workspace] Added `workspace init` and `workspace info` for a project-local `./.surfwright/` workspace (gitignored) that stores reusable browser profiles.
- [workspace] Added `workspace profile-locks` and `workspace profile-lock-clear` for introspecting and cleaning up stale profile locks.
- [auth] Added `open --profile <name>` and `run --profile <name>` to reuse a named workspace profile (persistent login state across agents).
- [cli] Added global `--workspace <dir>` (and `SURFWRIGHT_WORKSPACE_DIR`) to override workspace resolution.
- [session] Added `--browser-mode <headless|headed>` to managed session flows (`session ensure/new/fresh`, `open`, `run`) for headed/headless control (defaults unchanged).
- [contract] Added `browserMode` reporting to `open`/`session` JSON outputs (`unknown` for attached sessions).
- [open] Added redirect evidence fields to `open` output: `requestedUrl`, `finalUrl`, `wasRedirected`, optional `redirectChain` + `redirectChainTruncated` (keeps `url` as final).
- [open] Added first-class download capture via `open --allow-download` (saves to an artifacts dir and reports deterministic download metadata instead of `ERR_ABORTED`).
- [target] Added `target url-assert` for typed URL drift guards (`--host`, `--origin`, `--path-prefix`, `--url-prefix`).
- [target] Added `target frames` for bounded frame enumeration with stable `frameId` handles.
- [target] Added `target eval --expr <js>` (value-expression mode), `--frame-id <id>`, and compact `context` metadata in eval output.
- [target] Added `target click --index <n>` (0-based) and selection evidence (`matchCount`, `pickedIndex`) for deterministic multi-match actions.
- [target] Added `target click --explain` for bounded match selection/rejection diagnostics without clicking.
- [target] Added `target click --delta` for bounded evidence-based before/after change capture (URL/title, focus evidence, role counts, and clicked-element ARIA attribute values; no semantic UI claims).
- [target] Added `target snapshot --mode <snapshot|orient>` for quiet first-load orientation payloads (`orient` returns `h1` and scopes `links` to header/nav links).
- [target] Added `target snapshot --mode a11y` for bounded accessibility-tree rows (`a11y.rows`) with optional element `handle` values and paging via `ax=<n>` cursor tokens (`--max-ax-rows <n>`).
- [target] Added `target snapshot` paging via `--cursor <token>` and `nextCursor` in the report.
- [target] Added `target snapshot --include-selector-hints` returning bounded `items` rows with `selectorHint`.
- [target] Added `target snapshot-diff` for high-signal diffs between two saved snapshot reports.
- [target] Added `target count` for fast, bounded element counts (`--selector`/`--text`, optional `--visible-only`, optional `--frame-scope`).
- [target] Added `target download` for deterministic download capture (filename, sha256, size, headers/status when available) into an artifacts dir.
- [target] Added `--frame-scope <main|all>` to `target find/click/fill/spawn/wait` for deterministic cross-iframe queries/actions.
- [target] Added `target click --handle <handle>` to click an element handle returned by `target snapshot --mode a11y`.
- [network] Added `target network-around` to capture `network-begin` + click + `network-end` in one deterministic command.
- [network] Added per-capture sampling/redaction controls: `--body-sample-bytes` (bounded) and repeated `--redact-regex` (with safe defaults for sensitive header redaction when headers are included).
- [run] Added replayable evidence logs via `run --log-ndjson <path>` and `--log-mode <minimal|full>` (append-only NDJSON run log).

### Changed
- [release] Publish and release-draft workflows now use shared smoke script `scripts/release/smoke-contract.mjs`.
- [release] `release-check` now fails when `CHANGELOG.md` is missing the current package version section.
- [docs] `changelog-check` now enforces only the `Unreleased` skeleton buckets (with list items).
- [contract] `session list` now includes `browserMode` per session row.
- [contract] `open` and `session` JSON outputs now include `profile` when a workspace profile is in use.
- [cli] JSON output is now the default for all commands; use `--no-json` for human-friendly summaries and `--pretty` for multiline JSON.
- [docs] Documented headed/headless defaults and a minimal human login handoff recipe (README + skill).
- [docs] Added benchmark loop runbook `docs/campaigns/browser-control-surfwright-loop.md` and linked loop assets from campaign docs.
- [target] `target snapshot` now accepts `0` for `--max-chars`, `--max-headings`, `--max-buttons`, and `--max-links` to omit categories.
- [target] `target extract --kind blog/news/docs/generic` DOM presets now prioritize semantic tags/ARIA roles over site-shaped class selectors.
- [target] `target eval --script-file` now supports `--mode expr` to align return-value semantics with `--expr` (expression vs program).
- [network] Network capture reports now include explicit `limits.bodySampleBytes` and `redaction` metadata for safe evidence storage.
- [skill] Bumped `skills/surfwright` to `skillVersion=0.1.2` and refreshed lock metadata for the updated runtime contract fingerprint.

### Fixed
- [release] Removed drift-prone duplicate smoke command logic across release workflows.
- [daemon] `skill *` commands now bypass the daemon so relative `--source`/`--lock` paths resolve from the operator's current working directory (not a long-lived worker cwd).
- [target] Fixed DOM evaluation on some OOPIF-heavy pages (e.g. Substack custom domains) where Playwright `evaluate()` could bind to a hidden tracking iframe realm; `target eval/read/snapshot/extract/frames/health/screenshot` now execute DOM reads via CDP in an isolated world anchored to the selected frame.
- [target] Fixed `target find/click/fill/spawn/wait --for-text/--for-selector` on OOPIF-heavy pages by moving element queries/actions onto the same CDP isolated-world evaluator surface (avoids Playwright realm binding issues on reattached sessions).
- [target] Fixed `target spawn` on pages where programmatic `element.click()` does not open a new tab (uses a trusted mouse click instead).
- [target] Fixed `target eval` failing when an expression triggers navigation while persisting state (best-effort title capture).
- [target] Fixed intermittent `target click`/`target snapshot` follow-up reads failing after navigation by retrying CDP evaluations when cached execution contexts are invalidated.
- [network] Hardened `target network-begin` capture correctness by waiting for listener readiness before returning the `captureId`.
- [test] Browser contract tests now run with a default per-test timeout and abort-safe temp-root cleanup to prevent leaked Chrome processes.
- [test] Browser contract tests no longer depend on external websites (use local fixtures and local HTTP servers).

### Transition Notes
- [docs] None.

### Removed

## [0.1.1] - 2026-02-14

### Added
- [docs] Added release governance and contributor release-routing documentation.
- [ci] Added explicit changelog-check, release-check, and dual-package-parity CI jobs.
- [npm] Added dual-package workspace manifests for `@marcohefti/surfwright` and `surfwright`.
- [distribution] Added Homebrew tap sync workflow and deferred winget scaffold/backlog tracking.

### Changed
- [ci] Hardened CI workflows with concurrency, per-job timeouts, artifact uploads, and SHA-pinned actions.
- [contract] Release readiness checks now include dual-package parity validation and pack dry-run coverage.
- [release] Publish workflow now supports idempotent dual-package recovery runs and verifies npm provenance attestations for both package names.
- [release] Post-publish smoke checks now install package binaries in isolated temp dirs for deterministic verification.
- [docs] README install matrix now includes active Homebrew tap install/upgrade commands.

### Fixed
- [docs] Enforced changelog presence through `scripts/changelog-check.mjs` wired into `pnpm validate`.
- [release] Publish workflow smoke command resolution failures no longer block successful release verification.

## [0.1.0] - 2026-02-13

### Added
- [cli] Initial pre-alpha release.
