# Issue tracking

This is a contributor and maintainer workflow document for repository planning and backlog ownership.

Backlog ownership lives in GitHub issues, not in live markdown checklists.

The canonical flow is `issue -> plan -> PR`.

Workflow:
1. create or refine the owning same-repo issue
2. write the execution plan
3. implement on a branch
4. open the PR with the governed template

Cross-repo work should keep the authoritative backlog in the owning repo and use related links for coordination.

Same-repository Dependabot manifest updates may omit manual issue and plan fields only when the bot identity, configured
ecosystem branch, regular-file modes, and changed manifest/lock paths all pass the fail-closed governance validator.
