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
- `make format`
- `make lint`
- `make audit`
- `make verify-fast`
- `make verify`
- `make verify-localstack`
- `make verify-observability`
- `make verify-aws-smoke`
- `make plan-sync`
- `make plan-close ISSUE=<number>`

Default proof posture:
- no Docker boot
- no AWS dependency
- no live SNS/SQS requirement
- deterministic package, runtime, style, public package surface, and harness validation only

Optional proof lane:
- `make verify-localstack`
- LocalStack-backed SNS/SQS end-to-end coverage against the built package output
- local-first and opt-in only
- not part of the default CI or `make verify-fast`
- `make verify-observability`
- repo-owned OTEL/SigNoz backend proof layered on top of the built package output plus LocalStack fixtures
- local-first and opt-in only
- not part of the default CI or `make verify-fast`
- `make verify-aws-smoke`
- repo-owned live AWS smoke proof for real SNS/SQS feature families plus maintainer AWS SSO workflow
- manual GitHub Actions workflow plus release-time publish gate reuse the same repo-owned AWS smoke runner
- local-first and opt-in only
- not part of the default CI or `make verify-fast`
