# Follow-up Round 1

## 1) What else can we improve beyond the first pass?

Yes. Four additional improvements emerged:

1. Make CLI ingress routing manifest-driven instead of hardcoded.
References: `src/cli.ts:103-110`, `src/cli/options.ts:101-105`, `docs/architecture/features-and-commands.md:49-50`, `src/core/types.ts:331-335`.

2. Close the surface-command purity loophole for feature-root registration files.
References: `policy/rules/surface-command-purity.mjs:30-33`, `policy/rules/surface-command-purity.mjs:48-49`, `src/features/runtime/register-commands.ts:1`, `src/features/runtime/register-commands.ts:59`, `src/features/runtime/register-commands.ts:166`, `src/features/runtime/register-commands.ts:407`.

3. Deduplicate daemon metadata boundary logic.
References: `src/core/daemon/infra/daemon.ts:42-49`, `src/core/daemon/infra/daemon.ts:83-140`, `src/core/daemon/infra/worker.ts:22-29`, `src/core/daemon/infra/worker.ts:35-90`.

4. Tighten baseline budget ratchets so policy PASS better matches architecture health.
References: `policy/config.json:297`, `policy/config.json:312`, `policy/config.json:322`, `policy/config.strict.json:252`, `policy/config.strict.json:267`, `policy/config.strict.json:277`, `docs/architecture/policy-and-layering.md:114-115`.

## 2) Anything critical that could cause architectural fragility soon?

Yes, two high-risk items:

1. Hardcoded routing/bypass logic can drift quickly as the command surface expands.
Why critical soon: behavior depends on manual updates in multiple places instead of command metadata.
References: `src/cli.ts:103-110`, `src/cli/options.ts:104-105`, `src/core/types.ts:331-335`.

2. Runtime command root is already near LOC policy threshold and bypasses intended command purity checks.
Why critical soon: growth pressure is immediate (`491/500` lines) and structural guardrails are path-based.
References: `src/features/runtime/register-commands.ts:491`, `policy/config.json:272`, `policy/rules/surface-command-purity.mjs:30-33`, `policy/rules/surface-command-purity.mjs:48-49`.

Also still critical from round 0: current baseline policy already fails on core app purity.
References: `src/core/daemon/app/run-orchestrator.ts:1`, `src/core/daemon/app/run-orchestrator.ts:5`, `policy/rules/core-layer-purity.mjs:67-75`.

## 3) What should we improve now to make the system more maintainable and scalable moving forward?

Immediate sequence (high leverage, low coordination risk):

1. Introduce manifest-level execution traits and route daemon bypass from manifest data.
References: `src/core/types.ts:331-335`, `src/cli.ts:85-123`, `src/features/network/manifest.ts:11-15`, `src/features/target-core/manifest.ts:244-248`.

2. Refactor `features/runtime/register-commands.ts` into thin registration + command spec modules under `/commands/`.
References: `src/features/runtime/register-commands.ts:1-491`, `docs/architecture/features-and-commands.md:29-31`, `policy/config.json:272`.

3. Extract shared daemon metadata helpers to a single infra boundary module.
References: `src/core/daemon/infra/daemon.ts:51-53`, `src/core/daemon/infra/daemon.ts:103-140`, `src/core/daemon/infra/worker.ts:31-33`, `src/core/daemon/infra/worker.ts:55-90`.

4. Start ratcheting baseline budgets toward strict values on a fixed schedule.
References: `policy/config.json:297`, `policy/config.json:312`, `policy/config.json:322`, `policy/config.strict.json:252`, `policy/config.strict.json:267`, `policy/config.strict.json:277`.
