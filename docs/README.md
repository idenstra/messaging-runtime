# Documentation

This directory has two kinds of documentation:

1. product documentation for package consumers;
2. contributor documentation for repository workflow, release, and verification.

Start with the product documentation. Use the contributor documentation only when changing the package or release process.

## Product docs

| Document | Purpose |
| --- | --- |
| [`GETTING_STARTED.md`](GETTING_STARTED.md) | Build the first worker, use the common route factories, decode SNS-over-SQS messages, and publish messages. |
| [`FEATURES.md`](FEATURES.md) | Understand the supported runtime surface, current gaps, and deliberate non-goals. |
| [`RUNTIME_SEMANTICS.md`](RUNTIME_SEMANTICS.md) | Understand polling, concurrency, ack behavior, timeouts, heartbeats, and shutdown. |
| [`OPERATIONS.md`](OPERATIONS.md) | Configure workers, observe runtime state, test without AWS, and use the Nest adapter. |
| [`TESTING.md`](TESTING.md) | Run the deterministic harness plus the LocalStack, observability-local, and live AWS proof lanes. |
| [`AWS_SMOKE.md`](AWS_SMOKE.md) | Run the optional live AWS smoke lane through a public self-test path, upstream maintainer workflow path, and safe temporary fixtures. |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | Wire OTEL metrics and traces, propagate W3C context, and plan AWS worker autoscaling. |
| [`QUEUE_OPERATIONS.md`](QUEUE_OPERATIONS.md) | Inspect queues, manage native DLQ redrive tasks, and keep manual replay consumer-owned. |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Define the performance posture, benchmark plan, and performance review rules. |
| [`PUBLIC_RELEASE.md`](PUBLIC_RELEASE.md) | Track what must be true before making the repo and package public. |

## Existing architecture and compatibility docs

| Document | Purpose |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Package boundaries and internal structure. |
| [`USAGE.md`](USAGE.md) | Existing usage notes. Prefer `GETTING_STARTED.md` for the current entrypoint. |
| [`COMPATIBILITY.md`](COMPATIBILITY.md) | Supported import surface and pre-`1.0` consumer policy. |
| [`RELIABILITY.md`](RELIABILITY.md) | Verification and reliability posture. |
| [`SECURITY.md`](SECURITY.md) | Current security guardrails. |
| [`RELEASES.md`](RELEASES.md) | Current internal release flow. |

## Contributor and governance docs

| Document | Purpose |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Repository rules and contributor constraints. |
| [`../WORKFLOW.md`](../WORKFLOW.md) | Proof tiers and handoff expectations. |
| [`QUALITY_BAR.md`](QUALITY_BAR.md) | Engineering quality expectations. |
| [`AI_ENGINEERING.md`](AI_ENGINEERING.md) | AI-assisted engineering discipline. |
| [`ISSUE_TRACKING.md`](ISSUE_TRACKING.md) | Same-repo issue, execution plan, and PR flow. |
| [`EXECUTION_PLANS.md`](EXECUTION_PLANS.md) | Execution-plan lifecycle rules. |

## Documentation rules

- Keep consumer docs focused on package behavior, not internal migration history.
- Put operational caveats next to the API they affect.
- Do not claim public availability, benchmark numbers, or production hardening that the repo cannot prove.
- Prefer short examples that compile over broad prose descriptions.
- Move internal governance material out of the public reading path unless it is needed for consumers.
