# Architecture (Deep Dive Index)

`ARCHITECTURE.md` (repo root) is the short architecture map.
This file is the deep-dive index: it points to the subsystem notes that match real code boundaries.

Deep dives follow a consistent structure:

- Problem
- Design goals
- Non-goals
- Where the logic lives (file pointers)
- Runtime flow
- Invariants / guardrails
- Observability
- Testing expectations

## Deep Dives (Subsystem Notes)

- `docs/architecture/cli-and-daemon.md`
  - CLI entrypoint orchestration, dot-alias rewrite, daemon proxy path, and internal worker modes.
- `docs/architecture/contract-system.md`
  - Manifest-driven contract, fingerprinting, and the snapshot gate.
- `docs/architecture/features-and-commands.md`
  - Feature plugin registry, stability boundaries, and command registration pattern.
- `docs/architecture/state-and-versioning.md`
  - State store boundaries, agent scoping, and strict schema/version handling.
- `docs/architecture/policy-and-layering.md`
  - The policy harness and how to interpret ARC*/BUDG* violations without spelunking.

## Existing Canonical Docs (Do Not Duplicate)

- Policy harness: `docs/policy-harness.md`
- Change routing: `docs/agent-dev-flow.md`
- Maintainer workflow: `docs/maintaining-agent-surface.md`
- Release governance: `docs/release-governance.md`
- Update lifecycle: `docs/lifecycle/update-lifecycle.md`
- Skill lifecycle: `docs/skills-lifecycle.md`
- Fixture ingress workflow: `docs/fixture-ingress-workflow.md`
