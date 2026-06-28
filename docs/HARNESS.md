# Harness overview

`messaging-runtime` uses the standard Idenstra `issue -> plan -> PR` flow with a library-oriented harness.

Canonical details:
- [WORKFLOW.md](../WORKFLOW.md)
- [docs/QUALITY_BAR.md](QUALITY_BAR.md)
- [docs/EXECUTION_PLANS.md](EXECUTION_PLANS.md)
- [docs/ISSUE_TRACKING.md](ISSUE_TRACKING.md)
- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [scripts/README.md](../scripts/README.md)

Command surface:
- `make audit`
- `make verify-fast`
- `make verify`
- `make plan-sync`

Default proof posture:
- no Docker boot
- no AWS dependency
- no live SNS/SQS requirement
- deterministic package, runtime, and harness validation only
