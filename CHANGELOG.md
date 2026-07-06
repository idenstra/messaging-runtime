# Changelog

All notable changes to `@idenstra/messaging-runtime` must be tracked here.

Format rules:
- release sections use `## [x.y.z] - YYYY-MM-DD`
- the `package.json` version must have a matching changelog section before release
- breaking changes under `0.x` must be called out explicitly in the matching release notes

## [Unreleased]

### Added

- added a dedicated extension guide plus compile-checked examples for wrapped transport clients, consumer-owned helper composition, and lifecycle-bridge patterns on the supported public surface
- added a short `QUICK_START.md` path, a public `ADOPTION.md` rollout guide, and stronger package-facing security guidance for outside consumers
- added root OSS community files for the first public-repository posture slice: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and repository-level `SECURITY.md`

### Changed

- changed the public docs path so consumer onboarding stays separate from contributor and maintainer workflow material while preserving `AGENTS.md` as the primary AI-agent anchor
- changed GitHub issue and PR templates to a public-first hybrid shape that still preserves the repository governance metadata required by the current harness
- changed the package release posture so npmjs becomes the final public/default registry while GitHub Packages becomes a temporary tester lane driven by explicit release-workflow modes and tag-based promotion
## [0.2.0] - 2026-07-05

### Added

- added explicit `sqsJsonRoute(...)`, `snsJsonQueueRoute(...)`, and `sqsStringRoute(...)` factories for the most common worker declaration shapes
- added explicit finite-run execution through `runUntilIdle(...)` and `runBounded(...)` on both the manager and the service host
- added typed cross-account SQS queue-name resolution, typed preload entries, and read-only queue/topic discovery helpers
- added `@idenstra/messaging-runtime/observability` with OTEL metrics adapters, W3C trace propagation helpers, and worker span wrappers
- added OTEL/SigNoz observability docs, a compile-checked example worker, and AWS-aware autoscaling guidance for ECS/Fargate and Kubernetes
- added raw string and serializer-based SQS/SNS publisher helpers alongside the existing JSON and structured SNS surfaces
- added service-native SNS/SQS message-attribute builders, including `String.Array` support for SNS filter-policy-friendly attributes
- added optional local publish size validation with publisher defaults plus per-call override/disable for SQS and SNS helpers
- added queue inspection helpers and native SQS DLQ redrive task management through `SqsQueueInspector`, `SqsDlqRedriveManager`, and the combined `AwsSqsAdapter`
- added a consumer-owned queue-ops example script and explicit docs that keep manual message replay outside the shared package
- added transport-level batch helpers for SQS delete / visibility changes through `SqsMessageBatchOperator`
- added SNS batch JSON publish support through `SnsPublisher.publishJsonBatch(...)`
- added explicit SNS structured topic publishing through `publishStructuredJson(...)` and `publishStructuredJsonBatch(...)`
- added deterministic benchmark commands and tracked baseline artifacts for transport and worker hot-path review
- added benchmark-backed worker-core prefetch scenarios covering hot queues, stop/drain behavior, and buffered-backlog timeout handling
- added `benchmark:compare` plus same-machine benchmark comparison guidance for performance-sensitive pull requests
- added typed `message.systemAttributes` on `SqsWorkerMessage` for parsed SQS receive-count and timestamp system attributes
- added explicit runtime infrastructure failure events, rich snapshot fields, and OTEL counters for polling, delete-finalization, and buffered pre-dispatch visibility failure paths
- added benchmark coverage for decode, resolver, many-route scheduling, failure-keep, abandon-timeout, and snapshot hot paths plus runner self-tests for stable scenario ordering and machine-readable output
- added optional FIFO `ReceiveRequestAttemptId` support through manager defaults, manifest-safe receive policy, and route-owned custom token generation
- added shared route lifecycle hooks for startup, stop-signal, and cleanup across direct manager and service-host usage
- added thin queue-to-queue and queue-to-topic forwarding handlers that compose over the existing route factories and publisher surfaces
- added an optional `make verify-localstack` / `npm run e2e:localstack` lane that runs the built package against LocalStack-backed SNS/SQS fixtures across runtime, publishers, routing, discovery, and queue-ops flows
- added an optional `make verify-aws-smoke` / `npm run e2e:aws-smoke` lane plus AWS SSO runbook, suite selection, native redrive proof, and manual GitHub workflow / release-gate integration for real-AWS SNS/SQS feature validation

### Changed

- breaking: unified the consumer-facing AWS wrappers into `AwsSqsAdapter` and `AwsSnsAdapter`, removing the earlier `AwsSqsRuntimeClient`, `AwsSqsTransportClient`, and `AwsSnsTransportClient` names before wider package adoption
- breaking: `SqsRuntimeClient` now includes `deleteMessageBatch(...)`, and worker snapshots now expose `buffered` and `totalBuffered`
- changed the worker core implementation layout from a monolithic `src/core.ts` file to a folder-backed `src/core/` module set while preserving the public runtime surface and behavior
- changed `SqsWorkerManager` to use bounded per-route raw-message prefetch, buffered-message visibility-age protection, and route-local batched delete finalization
- changed the benchmark acceptance posture so checked-in baselines remain historical context while same-machine A/B comparison becomes the preferred throughput-review discipline
- changed worker polling to request SQS system attributes through `MessageSystemAttributeNames` instead of `AttributeNames`
- changed SNS publish helpers to allow standard-topic `messageGroupId`, reject standard-topic `messageDeduplicationId`, and align FIFO validation across single and batch publishing
- changed the live AWS smoke docs to include a public self-test path for any AWS account, separate from the upstream maintainer OIDC workflow and release gate

## [0.1.0] - 2026-06-29

### Added

- bootstrapped the private-first `@idenstra/messaging-runtime` package, harness, and governance surface
- extracted the shared SNS/SQS worker runtime core from the former bootstrap host repo
- added route failure policy, timeout semantics, runtime metrics hooks, and manager snapshots
- added SNS/SQS translators, resolvers, and JSON publisher helpers
- added worker-service host bootstrap, manifest-driven route activation, and signal runner ergonomics
- added internal release automation, release-state validation, and exact-version consumer policy for private GitHub Packages consumption
