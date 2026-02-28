# Maintainer Follow-up Questions (A3)

1. Do we want `--no-json` to be a strict cross-command contract invariant, or are there explicit command families (like `extension.*`) allowed to stay JSON-only?
2. Should `--compact` for `contract` be removed now (clean-slate), or do we want an explicit `deprecatedAliases` section in contract output so agents can discover tolerated legacy forms?
3. Is the intended authoritative command-path parser source Commander itself, or should we maintain a manifest-derived parser that supports all roots and arbitrary depth (`target trace insight`, `update check`, `skill doctor`, `extension list`)?
4. For compatibility rewrites in `argv-normalize` (`--target`, `session clear` wrappers, dot aliases), do we want a hard removal timeline, or do we want these formally represented in the machine contract?
5. For daemon queue errors (`E_DAEMON_QUEUE_TIMEOUT`, `E_DAEMON_QUEUE_SATURATED`), should CLI payloads include `retryable` explicitly so agent retry loops can be deterministic without code-mapping tables?
6. Are typed error messages considered contract-governed UX, or only error codes/retryability? Current snapshot/fingerprint gates enforce only code+retryable.
7. Should JSON-mode invalid-input failures suppress Commander human stderr to preserve single-envelope machine output, or is dual-channel output an intentional operator-first choice?
8. Do we want a dedicated contract test asserting `diagnostics.validFlags` and `canonicalInvocation` availability across all top-level command families (`runtime`, `target`, `network`, `extension`, `update`, `skill`, `exp`)?
