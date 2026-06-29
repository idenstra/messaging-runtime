---
repo: messaging-runtime
workspace_root: .
agent_entrypoint: AGENTS.md
risk_level_default: medium
required_docs:
  - AGENTS.md
  - docs/HARNESS.md
  - docs/QUALITY_BAR.md
  - docs/AI_ENGINEERING.md
  - docs/EXECUTION_PLANS.md
  - docs/ISSUE_TRACKING.md
required_checks:
  - make audit
  - make verify-fast
  - make verify
handoff_sections:
  - Summary
  - Acceptance criteria covered
  - Files changed
  - Checks run
  - Checks not run
  - Docs updated
  - Risk and rollback
  - Human review needed
human_review_required_for:
  - public_api_surface
  - package_metadata
  - release_posture
  - queue_semantics
notes:
  - AGENTS.md remains the canonical repo-rules document.
  - This file defines proof tiers and handoff expectations for library changes.
---

# Messaging runtime workflow

Start by reading:

1. `AGENTS.md`
2. `docs/HARNESS.md`
3. `docs/QUALITY_BAR.md`
4. `docs/AI_ENGINEERING.md`
5. the relevant execution plan, when required
6. the owning architecture and reliability docs for changed areas

Before coding, state:

- the runtime or package intent;
- acceptance criteria;
- public surface impact;
- files likely to change;
- checks you will run;
- risks and rollback.

## Standard work sequence

`docs/ISSUE_TRACKING.md` owns the non-trivial `issue -> plan -> PR` flow.
This file adds proof tiers and handoff expectations around that sequence.

## Work types and proof

| Work type | Minimum proof |
| --- | --- |
| `docs-only` | `make audit` |
| `package-or-harness` | `make verify-fast` |
| `public-surface-or-queue-semantics` | `make verify` |
| `release-or-registry-posture` | `make verify-fast` plus doc updates and release-state alignment |
| `incident-hotfix` | `make verify-fast` minimum, with deferred proof called out explicitly |

## Verify tiers

- `make audit`: deterministic harness audit for docs, templates, CI wiring, and package-governance surface.
- `make verify-fast`: validator self-tests, repo hygiene checks, style-drift validation, Biome lint, package install/build/test, `npm pack --dry-run`, and release-readiness validation.
- `make verify`: default repo gate; it currently aliases `make verify-fast`.
- `make plan-sync`: local execution-plan lifecycle sync that moves closed-issue plans from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.

## Exception protocol

- Use allowlists only for deterministic findings that are understood, owned, and time-bounded.
- Every allowlist entry must include a reason, owner, and `expires_on`.
- When required proof is skipped, call it out in handoff with the reason, impact, and follow-up path.
- Put broader deferred hardening in a follow-up issue, not in the change summary.
- Follow same-repo issue, plan, and PR-governance rules from `docs/ISSUE_TRACKING.md` and `docs/EXECUTION_PLANS.md`.

## Definition of done

- package or harness code updated where needed;
- docs updated in the same change-set;
- public surface kept aligned with intent;
- relevant tests updated or added;
- release/version/changelog state kept coherent when touching registry posture;
- required proof run for the work type;
- rollback stated for risky work;
- human review flagged when required.
