# Quality bar

This repo owns a shared runtime package. Quality must optimize for:

- explicit SNS/SQS semantics
- a stable, narrow public package surface
- deterministic local verification
- consumer-agnostic tests and examples
- no leakage of app-specific types or business logic

Every meaningful change should:
- update tests when behavior changes
- update docs when package contracts or workflow expectations change
- preserve the private-first, single-package posture unless a tracked issue changes that decision
- keep release metadata, changelog state, and package publication posture coherent
- keep runtime semantics stable unless a tracked issue explicitly expands behavior

Code and docs should read as if one disciplined maintainer wrote them:
- formatting and import organization are machine-enforced
- source and package-facing docs should not carry model, tool, or agent attribution
- `TODO`, `FIXME`, `HACK`, and `XXX` markers must reference a tracked issue or be removed
- examples should be explicit, boring, and free of placeholder-noise unless the placeholder is itself the point
