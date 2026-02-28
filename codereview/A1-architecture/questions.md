# A1 Follow-up Questions

1. Should daemon lane-resolution logic be CLI-argv specific, or should `core/daemon/domain` accept a CLI-agnostic request-intent DTO from app/infra?

2. For `src/core/*/public.ts`, do maintainers want infra exports to remain a permanent pattern, or is the goal to converge on app/domain-facing exports only?

3. Is the baseline `allowCrossDomainInternal` list in `policy/config.json` considered temporary migration debt with an owner/timeline, or intentional long-term architecture?

4. Should `src/core/target/{click,effects,frames,snapshot,url}` be formalized as first-class layers in policy, or migrated under `app/domain/infra` to match existing rule scopes?

5. Is `features/network` intended to be a true feature boundary (own usecases/domain behavior), or just a command namespace over `core/network` APIs?

6. Do you want `validate:strict` promoted into release-required checks after a planned burn-down, or kept non-blocking indefinitely?

7. Can we enforce unique policy rule IDs at registry load time to prevent ambiguous ARC/BUDG reporting, and should this be a hard CI failure?

8. For the daemon module specifically, what is the accepted boundary for parsing/formatting concerns between `app` and `infra` (for example, output mode parsing, typed failure serialization)?
