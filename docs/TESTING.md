# Testing

`messaging-runtime` keeps two proof layers distinct:

- the default deterministic harness;
- the optional LocalStack-backed end-to-end lane.

The default repo gate stays fast and AWS-free. The LocalStack lane exists for maintainers who need stronger proof that the built package still works against real AWS SDK calls and SNS/SQS emulator behavior.

## Default verification

Use these commands for the normal repository gate:

```bash
make audit
HARNESS_STRICT=1 make verify-fast
```

Those commands must stay deterministic:

- no Docker boot
- no LocalStack dependency
- no live AWS dependency

## Optional LocalStack lane

The LocalStack lane is the first end-to-end proof layer for the package surface.

Standard entrypoints:

```bash
make verify-localstack
npm run e2e:localstack
npm run e2e:localstack:ci
```

Subset execution is supported:

```bash
npm run e2e:localstack -- --suite runtime
npm run e2e:localstack -- --suite publishers,routing
```

Supported suite names:

- `runtime`
- `publishers`
- `routing`
- `discovery`
- `queue-ops`

The runner:

1. verifies Docker and `docker compose` are available;
2. builds the package;
3. starts the pinned LocalStack stack from `scripts/e2e/localstack/compose.yaml`;
4. provisions queues, topics, subscriptions, and policies dynamically for the selected suites;
5. runs the E2E tests against the built `dist/` package output;
6. tears LocalStack down on success and failure.

Fixture names use a per-run prefix so repeated local runs stay isolated and cleanup is explicit.

The compose file is pinned to a concrete `community-archive` LocalStack image digest. This lane intentionally stays auth-free and maintainable for local contributors; image upgrades should be deliberate repo changes, not ambient drift.

## Prerequisites

- Node.js `>=24`
- `npm ci`
- Docker
- Docker Compose v2
- free access to `127.0.0.1:4566`

No AWS credentials are required for this lane. The runner injects test credentials for LocalStack only.

## What the lane proves

Current LocalStack-backed coverage includes:

- worker receive -> handler -> delete
- keep/redelivery flows where emulator behavior is stable
- long-poll shutdown abort behavior
- visibility heartbeat extension
- route-local delete batching
- service-host manifest activation
- route lifecycle hooks during real worker runs
- finite-run `runUntilIdle(...)` and `runBounded(...)`
- FIFO `ReceiveRequestAttemptId` request-shape behavior through thin recording wrappers over real AWS SDK clients
- SQS publishers:
  - `sendJson(...)`
  - `sendJsonBatch(...)`
  - `sendString(...)`
  - `sendStringBatch(...)`
  - `sendSerialized(...)`
  - `sendSerializedBatch(...)`
- SNS publishers:
  - `publishJson(...)`
  - `publishJsonBatch(...)`
  - `publishString(...)`
  - `publishStringBatch(...)`
  - `publishSerialized(...)`
  - `publishSerializedBatch(...)`
  - `publishStructuredJson(...)`
  - `publishStructuredJsonBatch(...)`
- standard/FIFO SNS publish semantics that the package enforces locally
- attribute builders and raw message-attribute maps
- local `sizeValidation` rejection plus per-call override/disable behavior
- route factories:
  - `sqsJsonRoute(...)`
  - `sqsStringRoute(...)`
  - `snsJsonQueueRoute(...)`
- forwarding handlers for queue-to-queue and queue-to-topic relay flows
- queue resolution by name, URL, and ARN
- topic resolution by name and ARN
- queue discovery and topic discovery
- queue inspection and dead-letter source-queue listing
- native DLQ redrive when the pinned LocalStack image supports the underlying APIs cleanly

## Supported vs conditional emulator behavior

| Area | Status | Notes |
| --- | --- | --- |
| Worker runtime flows | Supported | Receive/delete, keep/redelivery, heartbeats, finite-run, lifecycle hooks, and FIFO receive-attempt request shapes are exercised directly. |
| Publisher surface | Supported | SQS and SNS helper modes run against real LocalStack-backed SDK calls. |
| Route factories and forwarding helpers | Supported | The lane exercises the built root export, not repo-internal imports. |
| Resolution and discovery helpers | Supported | Queue/topic resolution and pagination run against live emulator fixtures. |
| Queue inspection and DLQ source listing | Supported | Attribute normalization and DLQ-source discovery are part of the lane. |
| Native DLQ redrive | Conditional | The suite runs the smoke when the pinned LocalStack image supports SQS move-task APIs cleanly; otherwise it skips explicitly instead of producing flaky failures. |

## What this lane does not prove

`make verify-localstack` is stronger than unit tests, but it is still emulator proof. It does not prove:

- live AWS behavior
- IAM and AWS account wiring
- OTEL/SigNoz backend delivery
- production deployment correctness
- Nest adapter end-to-end boot

Use the future live AWS smoke lane for AWS-only confidence, and the future local OTEL backend lane for observability backend proof.

## When to run it

Run the LocalStack lane when a change touches:

- worker polling, ack, timeout, heartbeat, buffering, or shutdown behavior
- route factories or forwarding handlers
- SQS/SNS publishers
- resolver/discovery helpers
- queue inspection or native redrive helpers
- package examples or docs that describe end-to-end behavior

It is reasonable to run only the affected suites during iteration, then run the full lane before review when the change is runtime-facing.
