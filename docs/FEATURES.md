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
| SNS-over-SQS JSON decoding | Yes | `decodeSnsEnvelope` and `decodeSnsNotificationJson`. |
| Message delete on success | Yes | Default success action is delete, finalized through route-local delete batching in the worker core. |
| Keep message for redelivery | Yes | Handler or error policy can return `keep`. |
| Route-level error hook | Yes | `onError` can override failure action. |
| Handler timeout | Yes | Optional `handlerTimeoutMs`. |
| Timeout strategies | Yes | `cooperative` waits for handler settlement; `abandon` finalizes immediately and observes late settlement. |
| Visibility heartbeat | Yes | Interval heartbeat and manual `heartbeat()` callback. |
| Graceful shutdown | Yes | Poll abort plus in-flight task settlement. |
| Runtime events | Yes | Hook through `onEvent`. |
| Health snapshot | Yes | `getStatus()` and `getSnapshot()` include in-flight and buffered counts. |
| OTEL metrics adapter | Yes | `@idenstra/messaging-runtime/observability` maps runtime events and snapshots into an injected `Meter`. |
| W3C trace propagation helpers | Yes | Inject and extract `traceparent`, `tracestate`, and `baggage` through SNS/SQS message attributes. |
| Consumer span wrapper | Yes | `withOpenTelemetrySqsWorkerTracing(...)` wraps a route without changing worker-core semantics. |
| Manifest-driven route activation | Yes | `parseSqsWorkerServiceManifest` and `SqsWorkerServiceHost`. |
| Queue URL resolver | Yes | Name, URL, ARN, preload, optional no-network mode. |
| SNS topic ARN resolver | Yes | ARN, name lookup through `ListTopics`, preload, optional no-network mode. |
| SQS JSON publisher | Yes | Single-message and batch publishing. |
| SQS batch delete / visibility helpers | Yes | `SqsMessageBatchOperator` chunks automatically and normalizes partial success/failure by caller entry ID. |
| SNS JSON publisher | Yes | Single-message and batch publishing. |
| Queue inspection | Yes | `SqsQueueInspector` resolves queue identifiers and normalizes queue attributes. |
| DLQ source-queue discovery | Yes | `SqsQueueInspector.listDeadLetterSourceQueues(...)` paginates `ListDeadLetterSourceQueues`. |
| Native DLQ redrive control | Yes | `SqsDlqRedriveManager` wraps `StartMessageMoveTask`, `ListMessageMoveTasks`, and `CancelMessageMoveTask`. |
| SigNoz backend support | Docs only | Package code stays OTEL-first and vendor-neutral; SigNoz is the first documented OTLP backend example. |
| AWS-aware worker autoscaling guidance | Yes | ECS/Fargate and Kubernetes guidance is documented at the runbook level, not baked into the package. |
| Generic manual message replay | No | Manual replay remains consumer-owned because idempotency and payload safety are domain-specific. |
| Nest adapter | Yes | Optional lifecycle and logger bridge. |
| Live AWS integration tests | Not yet | Should be added as an optional lane, not a default local gate. |
| Deterministic local benchmark suite | Yes | `npm run benchmark`, `npm run benchmark:ci`, and tracked baseline artifacts under `docs/benchmarks/`, including worker-core prefetch scenarios. |

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
5. Observability guidance: document event names, counter meanings, health/readiness examples, and metrics mapping.
6. Worker-core fairness follow-up: if the bounded per-route design is not enough later, evaluate a heavier shared scheduler for many-route mixed workloads.

## Feature acceptance rule

A new feature belongs here only when all of these are true:

- it is specific to SNS/SQS runtime or publishing behavior;
- it can be tested without live AWS by default;
- it does not force a framework dependency into the core path;
- it has clear failure and ack semantics;
- it is documented in the same change set.
