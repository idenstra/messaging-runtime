# Changelog

All notable changes to `@idenstra/messaging-runtime` must be tracked here.

Format rules:
- release sections use `## [x.y.z] - YYYY-MM-DD`
- the `package.json` version must have a matching changelog section before release
- breaking changes under `0.x` must be called out explicitly in the matching release notes

## [Unreleased]

### Added

- added `@idenstra/messaging-runtime/observability` with OTEL metrics adapters, W3C trace propagation helpers, and worker span wrappers
- added OTEL/SigNoz observability docs, a compile-checked example worker, and AWS-aware autoscaling guidance for ECS/Fargate and Kubernetes
- added queue inspection helpers and native SQS DLQ redrive task management through `SqsQueueInspector`, `SqsDlqRedriveManager`, and the combined `AwsSqsAdapter`
- added a consumer-owned queue-ops example script and explicit docs that keep manual message replay outside the shared package
- added transport-level batch helpers for SQS delete / visibility changes through `SqsMessageBatchOperator`
- added SNS batch JSON publish support through `SnsPublisher.publishJsonBatch(...)`
- added deterministic benchmark commands and tracked baseline artifacts for transport and worker hot-path review
- added benchmark-backed worker-core prefetch scenarios covering hot queues, stop/drain behavior, and buffered-backlog timeout handling
- added `benchmark:compare` plus same-machine benchmark comparison guidance for performance-sensitive pull requests

### Changed

- breaking: unified the consumer-facing AWS wrappers into `AwsSqsAdapter` and `AwsSnsAdapter`, removing the earlier `AwsSqsRuntimeClient`, `AwsSqsTransportClient`, and `AwsSnsTransportClient` names before wider package adoption
- breaking: `SqsRuntimeClient` now includes `deleteMessageBatch(...)`, and worker snapshots now expose `buffered` and `totalBuffered`
- changed `SqsWorkerManager` to use bounded per-route raw-message prefetch, buffered-message visibility-age protection, and route-local batched delete finalization
- changed the benchmark acceptance posture so checked-in baselines remain historical context while same-machine A/B comparison becomes the preferred throughput-review discipline

## [0.1.0] - 2026-06-29

### Added

- bootstrapped the private-first `@idenstra/messaging-runtime` package, harness, and governance surface
- extracted the shared SNS/SQS worker runtime core from the former bootstrap host repo
- added route failure policy, timeout semantics, runtime metrics hooks, and manager snapshots
- added SNS/SQS translators, resolvers, and JSON publisher helpers
- added worker-service host bootstrap, manifest-driven route activation, and signal runner ergonomics
- added internal release automation, release-state validation, and exact-version consumer policy for private GitHub Packages consumption
