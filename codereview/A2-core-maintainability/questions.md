# Follow-up Questions for Maintainers

1. Are we willing to enforce a soft file-size budget for core command handlers (for example `<=250` LOC) to prevent more 450-500 LOC hotspots?
2. Should we define one shared in-page DOM helper contract (`isVisible`, `selectorHintFor`, `textFor`, interactive selector pool) so `target find/count/attr/extract` cannot drift semantically?
3. Do you want command lifecycle concerns (session resolve/connect/timing/persist/finally-close) centralized in a shared helper even if it changes several command files in one refactor window?
4. Is `target form-fill` intentionally colocated with `target read`, or can we treat them as separate bounded contexts and split now?
5. Can `parseJsonObjectText` move out of `target-eval.ts` to a neutral shared utility to remove command-to-command coupling (`target-extract` -> `target-eval`)?
6. For runtime CLI wiring, should we adopt a command-registration pattern per domain (`open/session/run/...`) with a common action wrapper, or keep single-file registration for discoverability?
7. In `browser.ts`, do you prefer hard module boundaries (`discovery`, `process`, `session-lifecycle`) or a smaller first step that only extracts process management first?
8. For target report types, do you want modular type files now, or should this wait until the next contract-versioning milestone?
