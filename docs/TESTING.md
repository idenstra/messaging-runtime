# Testing

`messaging-runtime` keeps four proof layers distinct:

- the default deterministic harness;
- the optional LocalStack-backed end-to-end lane;
- the optional OTEL/SigNoz observability backend lane;
- the optional live AWS smoke lane.

The default repo gate stays fast and AWS-free. The LocalStack lane exists for maintainers who need stronger proof that the built package still works against real AWS SDK calls and SNS/SQS emulator behavior. The observability lane exists for maintainers who need end-to-end proof that the documented OTEL metrics, tracing, and W3C propagation story reaches a real local backend. The live AWS smoke lane exists for maintainers who need one final real-AWS feature-integrity pass plus an explicit AWS SSO runbook.

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

Use the observability backend lane for local OTEL/SigNoz proof, and use the live AWS smoke lane for AWS-only confidence after the local layers are green.

## Optional observability backend lane

The observability lane is the second end-to-end proof layer for the package surface.

Standard entrypoints:

```bash
make verify-observability
npm run e2e:observability
npm run e2e:observability:ci
```

This lane:

1. verifies Docker and `docker compose` are available;
2. builds the package;
3. starts the pinned local SigNoz stack from `scripts/e2e/observability/compose.yaml`;
4. starts the pinned LocalStack stack from `scripts/e2e/localstack/compose.yaml`;
5. runs observability E2E tests against the built `dist/` package output;
6. tears both stacks down with volumes on success and failure.

Default local ports are intentionally repo-specific so this lane can coexist with other stacks:

- SigNoz UI: `127.0.0.1:18080`
- OTLP gRPC: `127.0.0.1:14317`
- OTLP HTTP: `127.0.0.1:14318`

You may override those ports through:

- `MESSAGING_RUNTIME_SIGNOZ_UI_PORT`
- `MESSAGING_RUNTIME_SIGNOZ_OTLP_GRPC_PORT`
- `MESSAGING_RUNTIME_SIGNOZ_OTLP_HTTP_PORT`

The supported low-level escape hatch for the backend stack is:

```bash
docker compose -f scripts/e2e/observability/compose.yaml up -d
docker compose -f scripts/e2e/observability/compose.yaml down -v
```

Current observability-backed coverage includes:

- direct SQS worker success flow with runtime metrics and consumer spans
- snapshot-derived gauges sourced from `getSnapshot()`
- raw SNS -> SQS W3C propagation through a real backend path
- handler failure counters plus error spans
- timeout counters plus heartbeat-success counters
- delete-batch failure telemetry through the real LocalStack-backed delete path

Scriptable backend verification is direct and backend-real:

- traces are verified through `signoz_traces.signoz_index_v3`
- metrics are verified through `signoz_metrics.samples_v4` joined to `signoz_metrics.time_series_v4`
- each test run uses a unique `smoke.run_id`

`make verify-observability` proves more than unit tests or LocalStack alone, but it still does not prove:

- live AWS behavior
- IAM and AWS account wiring
- OTLP logs behavior
- production deployment correctness
- Nest adapter end-to-end boot

Use the live AWS smoke lane for AWS-only confidence after the local proof layers are green.

## Optional live AWS smoke lane

The live AWS smoke lane is the final optional proof layer for maintainers.

Standard entrypoints:

```bash
make verify-aws-smoke
npm run e2e:aws-smoke
npm run e2e:aws-smoke:ci
```

Subset execution is supported:

```bash
npm run e2e:aws-smoke -- --suite transport,worker
npm run e2e:aws-smoke -- --suite redrive
```

Supported suite names:

- `transport`
- `worker`
- `routing`
- `discovery`
- `queue-ops`
- `redrive`

This lane:

1. builds the package;
2. validates that the current shell is not still pointed at LocalStack or test credentials;
3. verifies live AWS identity through STS;
4. provisions temporary queues, topics, subscriptions, and the dedicated redrive fixtures through AWS SDK calls in test harness code only;
5. runs suite-based real-AWS smoke tests against the built `dist/` package output;
6. tears the temporary resources down at the end of the run.

The live AWS lane proves real SNS/SQS behavior for:

- queue and topic resolution;
- queue and topic discovery;
- queue inspection and dead-letter source listing;
- representative SQS and SNS publish flows, including batch helpers;
- raw and envelope SNS -> SQS flows;
- message-attribute propagation;
- worker receive/delete flow through the hosted worker shape;
- route lifecycle hooks and finite-run execution through a real worker path;
- FIFO receive-attempt request-shape proof;
- forwarding helper flows;
- native DLQ redrive start/list/cancel behavior through dedicated real AWS fixtures.

This lane is still not a production-deployment proof. It exists to answer the AWS-only questions that LocalStack and the local observability backend cannot answer.

The full AWS SSO runbook, fixture naming rules, IAM expectations, cleanup posture, manual workflow usage, and release-time publish gate behavior live in [`AWS_SMOKE.md`](AWS_SMOKE.md).

## When to run it

Run the LocalStack lane when a change touches:

- worker polling, ack, timeout, heartbeat, buffering, or shutdown behavior
- route factories or forwarding handlers
- SQS/SNS publishers
- resolver/discovery helpers
- queue inspection or native redrive helpers
- package examples or docs that describe end-to-end behavior

It is reasonable to run only the affected suites during iteration, then run the full lane before review when the change is runtime-facing.

Run the observability lane when a change touches:

- `@idenstra/messaging-runtime/observability`
- runtime events or snapshot fields consumed by the OTEL adapter
- W3C propagation helpers
- docs/examples that describe the OTEL or SigNoz setup
- worker tracing behavior

Run the live AWS smoke lane when:

- LocalStack is already green;
- the change still depends on real AWS SNS/SQS semantics for confidence;
- the change touched discovery, queue inspection, or native redrive behavior;
- release or maintainership proof needs an AWS-backed pass;
- a question remains about actual queue/topic resolution, raw or envelope SNS -> SQS delivery, attribute propagation, hosted worker receive/delete behavior, or real redrive semantics.
