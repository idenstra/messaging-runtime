# Execution plans

This is a contributor and maintainer workflow document for non-trivial repository changes.

Non-trivial work in this repo follows the same-repo `issue -> plan -> PR` flow.

Rules:
- use a same-repo issue for the owning work item
- create an active execution plan under `docs/exec-plans/active/`
- use the issue-numbered filename format: `<issue>-slug.md`
- move plans for closed issues into `docs/exec-plans/completed/`

Templates:
- [docs/templates/execution-plan.md](templates/execution-plan.md)
- [docs/templates/handoff.md](templates/handoff.md)

Lifecycle tooling:
- `make plan-sync`
- `make plan-close ISSUE=<number>`

Closeout PR rule:
- if a PR body closes an issue with `Closes #...`, `Fixes #...`, or `Resolves #...`, that PR is treated as the closeout PR for the issue
- closeout PRs must move the plan into `docs/exec-plans/completed/` in the same change-set
- the PR `Execution plan:` field must point at the completed plan path, not the active one
- use `make plan-close ISSUE=<number>` to perform that deliberate local move before the issue is actually closed on GitHub

Backstop rule:
- `make plan-sync` still exists for the post-close lifecycle case and for catching stale active plans
- `make verify-fast` treats a closed issue left under `docs/exec-plans/active/` as invalid state
