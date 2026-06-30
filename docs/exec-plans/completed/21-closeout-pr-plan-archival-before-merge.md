# `messaging-runtime#21` Execution Plan: Closeout PR Plan Archival Before Merge

## Summary

Make closeout PRs carry their own execution-plan lifecycle move.

If a PR body closes a same-repo issue, that PR must:
- move the numbered execution plan from `docs/exec-plans/active/` to `docs/exec-plans/completed/`
- update the PR `Execution plan:` field to the completed path

The intent is to keep `messaging-runtime` strict without letting `main` be the first place that notices lifecycle drift.

## Scope

- update PR-governance validation
- add a local closeout helper command
- update templates and docs
- prove the policy on a real PR by first failing with an active-plan closeout and then passing after the plan is moved to completed

## Non-goals

- do not change `CDP` in this slice
- do not mutate repo state from CI
- do not relax `messaging-runtime` back to post-merge cleanup-only behavior

## Implementation

1. Extend PR governance so closing PRs may not reference an active execution plan path.
2. Allow completed execution-plan paths in `Execution plan:` for closeout PRs.
3. Add a local helper that moves one numbered active plan to `completed/` before merge.
4. Update docs, templates, and audit expectations so the command surface and workflow stay aligned.

## Proof

- `HARNESS_STRICT=1 make verify-fast`
- open a ready-for-review PR that says `Closes #21` while still referencing this active plan and confirm governance fails
- move this plan into `docs/exec-plans/completed/`, update the PR body to the completed path, push again, and confirm governance passes

## Risks

- PR governance must stay explicit and deterministic; closeout logic cannot depend on CI mutating the repo.
- The closeout helper must stay local-only and must not weaken the existing post-close `make plan-sync` behavior.
