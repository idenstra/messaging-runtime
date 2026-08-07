# Documentation

This docs set is split into product docs for package consumers and contributor docs for repository workflow.

Start with the product docs. Use the contributor docs only when changing the package or its release process.

## Start

| Document | Purpose |
| --- | --- |
| [`QUICK_START.md`](QUICK_START.md) | The shortest path to a working worker and publisher. |
| [`GETTING_STARTED.md`](GETTING_STARTED.md) | Cookbook-style recipes for common worker, publisher, queue-ops, and observability setups. |
| [`USAGE.md`](USAGE.md) | Conceptual overview of how the runtime, transport helpers, queue ops, and package terminology fit together. |

## Build

| Document | Purpose |
| --- | --- |
| [`FEATURES.md`](FEATURES.md) | Supported capabilities, non-goals, and the current maturity boundary. |
| [`RUNTIME_SEMANTICS.md`](RUNTIME_SEMANTICS.md) | Polling, concurrency, ack, timeout, heartbeat, shutdown, and redelivery semantics. |
| [`QUEUE_OPERATIONS.md`](QUEUE_OPERATIONS.md) | Queue discovery, inspection, native DLQ redrive, and consumer-owned manual reprocessing boundaries. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Package boundaries, internal layout, and extension-safe ownership lines. |
| [`COMPATIBILITY.md`](COMPATIBILITY.md) | Supported imports, Semantic Versioning boundaries, and the stable `1.x` compatibility contract. |

## Operate

| Document | Purpose |
| --- | --- |
| [`OPERATIONS.md`](OPERATIONS.md) | Configuration boundaries, readiness, scaling, testing posture, and queue-ops ownership. |
| [`OBSERVABILITY.md`](OBSERVABILITY.md) | OTEL metrics/traces, W3C propagation, SigNoz wiring, and autoscaling guidance. |
| [`ADOPTION.md`](ADOPTION.md) | Roll the library into a real service one worker shape at a time. |
| [`SECURITY.md`](SECURITY.md) | Package-facing security, IAM, trust-boundary, duplicate-processing, and smoke-test safety guidance. |

## Extend

| Document | Purpose |
| --- | --- |
| [`EXTENDING.md`](EXTENDING.md) | Supported extension seams for adapters, helper layers, lifecycle bridges, and observability wiring. |

## Prove

| Document | Purpose |
| --- | --- |
| [`TESTING.md`](TESTING.md) | Deterministic checks plus the optional LocalStack, observability-local, and live AWS proof lanes. |
| [`AWS_SMOKE.md`](AWS_SMOKE.md) | Public self-test path, maintainer OIDC path, and temporary-fixture safety for live AWS smoke. |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Benchmark posture, same-machine comparison rules, and performance review expectations. |
| [`RELIABILITY.md`](RELIABILITY.md) | Overall verification and reliability posture. |

## Release and reference

| Document | Purpose |
| --- | --- |
| [`MIGRATIONS.md`](MIGRATIONS.md) | Breaking-release migration-note format and future upgrade guidance location. |

## Contributor / Maintainer

| Document | Purpose |
| --- | --- |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Public contributor entrypoint and proof expectations. |
| [`../AGENTS.md`](../AGENTS.md) | Repository rules and contributor constraints. |
| [`../WORKFLOW.md`](../WORKFLOW.md) | Proof tiers and handoff expectations. |
| [`HARNESS.md`](HARNESS.md) | Harness entrypoints and deterministic repo gates. |
| [`QUALITY_BAR.md`](QUALITY_BAR.md) | Engineering quality expectations. |
| [`AI_ENGINEERING.md`](AI_ENGINEERING.md) | AI-assisted engineering discipline. |
| [`ISSUE_TRACKING.md`](ISSUE_TRACKING.md) | Same-repo issue, execution plan, and PR flow. |
| [`EXECUTION_PLANS.md`](EXECUTION_PLANS.md) | Execution-plan lifecycle rules. |
| [`RELEASES.md`](RELEASES.md) | Current registry and release mechanics for maintainers. |

## Documentation rules

- Keep consumer docs focused on package behavior, not internal migration history.
- Favor short, compile-checked examples over broad prose.
- Put operational caveats next to the API or behavior they affect.
- Keep the first-run path short; move cookbook detail into `GETTING_STARTED.md`.
- Keep public docs usable without private sibling repos, private AWS accounts, or private workflow variables.
