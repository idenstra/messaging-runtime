# Features

`messaging-runtime` is a focused SNS/SQS runtime. Its maturity should come from being excellent at one transport family, not from pretending every broker has the same semantics.

## Runtime capabilities

| Capability | Supported | Notes |
| --- | --- | --- |
| SQS long polling | Yes | Per route through `waitTimeSeconds`. |
| Bounded concurrency | Yes | Per route through `concurrency`. |
| SQS max messages per poll | Yes | Capped to SQS maximum of 10. |
| Bounded per-route prefetch | Yes | Raw-message prefetch is capped to `min(concurrency, maxMessagesPerPoll)` per route. |
| Plain SQS JSON decoding | Yes | Built-in default route decode parses JSON bodies when a route does not supply `decodePayload`. `decodeSqsJsonBody` is also exported for explicit typed decoders. |
| Common route factories | Yes | `sqsJsonRoute(...)`, `snsJsonQueueRoute(...)`, and `sqsStringRoute(...)` cover the most common worker declaration shapes while preserving the existing route/host model. |
| SNS-over-SQS JSON decoding | Yes | `decodeSnsEnvelope` and `decodeSnsNotificationJson`. |
| Message delete on success | Yes | Default success action is delete, finalized through route-local delete batching in the worker core. |
| Keep message for redelivery | Yes | Handler or error policy can return `keep`. |
| Route-level error hook | Yes | `onError` can override failure action. |
| Shared route lifecycle hooks | Yes | `route.lifecycle.beforeStart`, `afterStart`, `beforeStop`, and `afterStop` work for both direct-manager and service-host usage. |
| Handler timeout | Yes | Optional `handlerTimeoutMs`. |
| Timeout strategies | Yes | `cooperative` waits for handler settlement; `abandon` finalizes immediately and observes late settlement. |
| Visibility heartbeat | Yes | Interval heartbeat and manual `heartbeat()` callback. |
| Graceful shutdown | Yes | Poll abort plus in-flight task settlement. |
| Runtime events | Yes | Hook through `onEvent`, including polling, delete-finalization, and pre-dispatch visibility infrastructure failures. |
| Health snapshot | Yes | `getStatus()` and `getSnapshot()` include in-flight/buffered counts plus rich last-occurrence fields for infrastructure failures. |
| OTEL metrics adapter | Yes | `@idenstra/messaging-runtime/observability` maps runtime events and snapshots into an injected `Meter`. |
| W3C trace propagation helpers | Yes | Inject and extract `traceparent`, `tracestate`, and `baggage` through SNS/SQS message attributes. |
| Consumer span wrapper | Yes | `withOpenTelemetrySqsWorkerTracing(...)` wraps a route without changing worker-core semantics. |
| Manifest-driven route activation | Yes | `parseSqsWorkerServiceManifest` and `SqsWorkerServiceHost`. |
| Queue URL resolver | Yes | Name, URL, ARN, typed cross-account name resolution, legacy preload, typed preload entries, optional no-network mode. |
| SNS topic ARN resolver | Yes | ARN, name lookup through `ListTopics`, preload, optional no-network mode. |
| SQS JSON publisher | Yes | Single-message and batch publishing. |
| SQS string publisher | Yes | `sendString(...)` and `sendStringBatch(...)` send your exact SQS body as-is. |
| SQS serializer publisher | Yes | `sendSerialized(...)` and `sendSerializedBatch(...)` accept typed payloads plus a synchronous string serializer. |
| SQS attribute builders | Yes | `sqsStringAttribute(...)`, `sqsNumberAttribute(...)`, and `sqsBinaryAttribute(...)` build supported SQS message-attribute shapes. |
| SQS batch delete / visibility helpers | Yes | `SqsMessageBatchOperator` chunks automatically and normalizes partial success/failure by caller entry ID. |
| SNS string-mode JSON publisher | Yes | `publishJson(...)` and `publishJsonBatch(...)` send normal SNS string bodies built from `JSON.stringify(...)`. |
| SNS raw string publisher | Yes | `publishString(...)` and `publishStringBatch(...)` send your exact SNS string body as-is. |
| SNS serializer publisher | Yes | `publishSerialized(...)` and `publishSerializedBatch(...)` keep typed payloads in consumer code while letting you choose the string serializer. |
| SNS attribute builders | Yes | `snsStringAttribute(...)`, `snsNumberAttribute(...)`, `snsBinaryAttribute(...)`, and `snsStringArrayAttribute(...)` build supported SNS message-attribute shapes. |
| SNS structured topic publisher | Yes | `publishStructuredJson(...)` and `publishStructuredJsonBatch(...)` set `MessageStructure: 'json'` for protocol-specific topic messages. |
| Optional local publish size validation | Yes | Publisher defaults and per-call `sizeValidation` can reject oversized SQS/SNS requests before AWS calls. |
| Read-only SQS queue discovery | Yes | `SqsQueueDiscovery.listQueues(...)` supports page-first listing with AWS-native prefix filtering. |
| Read-only SNS topic discovery | Yes | `SnsTopicDiscovery.listTopics(...)` exposes the native page-first `ListTopics` surface as normalized topic summaries. |
| Queue inspection | Yes | `SqsQueueInspector` resolves queue identifiers and normalizes queue attributes. |
| DLQ source-queue discovery | Yes | `SqsQueueInspector.listDeadLetterSourceQueues(...)` paginates `ListDeadLetterSourceQueues`. |
| Native DLQ redrive control | Yes | `SqsDlqRedriveManager` wraps `StartMessageMoveTask`, `ListMessageMoveTasks`, and `CancelMessageMoveTask`. |
| SigNoz backend support | Docs only | Package code stays OTEL-first and vendor-neutral; SigNoz is the first documented OTLP backend example. |
| AWS-aware worker autoscaling guidance | Yes | ECS/Fargate and Kubernetes guidance is documented at the runbook level, not baked into the package. |
| Generic manual message replay | No | Manual replay remains consumer-owned because idempotency and payload safety are domain-specific. |
| Nest adapter | Yes | Optional lifecycle and logger bridge. |
| Live AWS integration tests | Not yet | Should be added as an optional lane, not a default local gate. |
| Deterministic local benchmark suite | Yes | `npm run benchmark`, `npm run benchmark:ci`, `npm run benchmark:compare`, and tracked baseline artifacts under `docs/benchmarks/`, including worker-core prefetch scenarios. |

## Public API shape

Supported imports are intentionally narrow:

```ts
import { ... } from '@idenstra/messaging-runtime';
import { ... } from '@idenstra/messaging-runtime/core';
import { ... } from '@idenstra/messaging-runtime/nest';
import { ... } from '@idenstra/messaging-runtime/observability';
```

Avoid deep imports into `dist/` or internal source files. The public surface should stay small enough that breaking changes are visible in API review.

## Deliberate non-goals

The package should not add:

- Kafka, RabbitMQ, Redis stream, Pub/Sub, or generic broker providers;
- provider-neutral route abstractions that hide SNS/SQS semantics;
- business handlers;
- application payload contracts;
- persistence, outbox, inbox, or idempotency storage;
- generic manual replay or message mutation tooling;
- environment or secrets loading;
- dynamic module or handler discovery;
- runtime dependencies on Nest in the core package path.

These omissions are part of the design. Generic broker abstractions tend to erase the exact behavior that matters most for SQS: visibility timeout, receive batch size, delete semantics, redelivery, and long-poll cost.

## Feature gaps to close before public release

The core feature set is credible, but the public maturity story is not complete until the following gaps are closed:

1. Public package posture: license, package metadata, registry access, contribution docs, security policy, issue templates, and release instructions.
2. Optional integration proof: emulator-backed or LocalStack-style tests for receive, delete, visibility, publish, and resolver flows.
3. API ergonomics follow-through: keep the combined AWS adapter examples, naming parity, and supported wrapper contract consistent as the package grows.
4. Production guidance: keep idempotency expectations, poison-message handling, retry/redrive policy ownership, and recommended queue settings explicit.
5. SNS publishing guidance: keep fair-queue `MessageGroupId`, FIFO/content-based deduplication, and structured-message boundaries explicit as the publisher surface expands.
6. Observability guidance: document event names, counter meanings, health/readiness examples, and metrics mapping.
7. Worker-core fairness follow-up: if the bounded per-route design is not enough later, evaluate a heavier shared scheduler for many-route mixed workloads.

## Feature acceptance rule

A new feature belongs here only when all of these are true:

- it is specific to SNS/SQS runtime or publishing behavior;
- it can be tested without live AWS by default;
- it does not force a framework dependency into the core path;
- it has clear failure and ack semantics;
- it is documented in the same change set.
