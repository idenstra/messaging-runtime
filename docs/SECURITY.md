# Security

This document covers the package-facing security and safety boundaries for `@idenstra/messaging-runtime`.

For repository-level vulnerability disclosure and reporting, use the root [`SECURITY.md`](../SECURITY.md) policy.

## Security ownership boundary

The package owns reusable SNS/SQS mechanics. Consumer services still own:

- secrets and environment loading
- IAM policy decisions
- queue/topic provisioning
- business-level authorization
- idempotency storage
- domain-safe manual reprocessing or recovery rules
- deployment and network boundaries

That split is deliberate. The runtime should stay deterministic and transport-focused.

## Secrets and credentials

Never commit:

- AWS access keys
- session tokens
- registry tokens
- GitHub package or publish tokens
- OTLP backend secrets

The library does not read env files or secrets managers directly. Load credentials and configuration in the consumer app, then construct AWS SDK clients and runtime helpers explicitly.

## Least-privilege IAM

Consumers should grant only the permissions required for the worker or publisher path they actually use.

Typical worker needs:

- SQS receive
- SQS delete
- SQS visibility change
- queue URL resolution when names are resolved dynamically

Typical publisher needs:

- SQS send
- SNS publish
- topic discovery only when a name-to-ARN resolver is used

Queue-ops and redrive helpers require broader SQS permissions and should be treated as operational tooling, not as baseline application permissions.

See [`AWS_SMOKE.md`](AWS_SMOKE.md) for the real-AWS smoke IAM example and fixture posture.

## Message trust boundary

Treat message bodies and attributes as untrusted input.

Consumers should:

- validate payload shape where business correctness depends on it
- reject malformed or unexpected data clearly
- keep domain authorization checks in the application layer
- avoid assuming that message attributes or payload fields are inherently trusted

`decodeSqsJsonBody(...)` and `decodeSnsNotificationJson(...)` help with transport decoding. They are not domain-schema validators.

## Duplicate processing and idempotency

SQS remains at-least-once.

That means:

- duplicates are possible
- late settlement is possible
- `keep` behavior can intentionally preserve redelivery
- timeout and shutdown boundaries do not create exactly-once guarantees

If duplicate processing is unsafe, the consumer service must own idempotency.

At minimum, document:

- idempotency key strategy
- duplicate-write behavior
- poison-message handling
- DLQ/redrive ownership
- visibility timeout sizing

See [`OPERATIONS.md`](OPERATIONS.md) and [`ADOPTION.md`](ADOPTION.md).

## DLQ and manual reprocessing safety

The package owns:

- queue inspection
- DLQ source discovery
- native SQS redrive task control

The package does **not** own generic manual reprocessing helpers.

That boundary exists because consumer-owned manual reprocessing correctness depends on:

- business idempotency rules
- payload meaning
- downstream side effects
- tenant/customer/domain policy that should stay out of the shared package

Treat native redrive and consumer-owned manual reprocessing as different operations:

- native redrive is package-owned queue behavior
- consumer-owned manual reprocessing remains consumer-owned domain behavior

## Observability safety

The observability surface is OTEL-first and vendor-neutral. Consumers should still review what they emit.

Be deliberate about:

- payloads or attributes copied into spans or metrics
- sensitive identifiers in message attributes
- error detail that may reveal internal state
- telemetry endpoint credentials

Prefer low-cardinality runtime attributes and keep business payload data out of metrics.

## Local and live proof-lane safety

Default repo verification is intentionally AWS-free and Docker-free.

When running optional proof lanes:

- LocalStack fixtures are temporary and should remain test-only
- observability-local stacks should not reuse production endpoints or credentials
- live AWS smoke should run in a sandbox account or tightly scoped fixture space
- fixture prefixes and cleanup must stay explicit

See:

- [`TESTING.md`](TESTING.md)
- [`AWS_SMOKE.md`](AWS_SMOKE.md)

## Registry and publication posture

Tracked repo files may contain:

- scope-to-registry mapping
- package metadata
- release workflow wiring

They must not contain:

- auth tokens
- publish secrets
- static AWS credentials

Repository-level disclosure and reporting policy lives in the root [`SECURITY.md`](../SECURITY.md). This guide stays focused on package behavior and consumer safety boundaries.
