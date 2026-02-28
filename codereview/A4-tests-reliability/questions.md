# Follow-up Questions

1. Should `pnpm test` remain a fast non-browser lane intentionally, or do you want it to become the full release-equivalent lane (including `test:browser`)?
2. For ingress fixtures, do you want runtime replay to execute against deterministic `data:` pages only, or also support local fixture servers for network-heavy commands?
3. Is the one-retry behavior in `test/browser/target/effects/target.effects.browser.mjs` acceptable as policy, or should browser contract tests be strictly first-attempt deterministic?
4. Do you want a hard policy that forbids `test.skip` in `test/browser/**` (same as current contract no-skip enforcement)?
5. For the uncovered command IDs (e.g., `workspace.info`, `extension.reload`, `target.network-check`, `exp.effects`), which subset is highest priority for behavior-level regression tests this sprint?
6. Should we standardize all contract tests on a shared `cli-contract-runner` helper with mandatory timeout budget and process-group termination?
7. Do you want the command-smoke matrix to be generated dynamically from `surfwright contract --full` at test time, or pinned to fixture lists for reproducibility?
8. Should release-draft workflow be self-sufficient (run browser lane itself) even if CI already runs browser tests on PR/main?
