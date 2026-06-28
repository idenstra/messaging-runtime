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

