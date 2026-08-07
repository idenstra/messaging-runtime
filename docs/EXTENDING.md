# Extending

`messaging-runtime` is intentionally extensible, but only through SNS/SQS-native seams.

The project does not want transport-neutral abstractions. It does want outside consumers to be able to:

- wrap AWS SDK clients;
- add helper layers on top of publishers, resolvers, and queue ops;
- bridge worker lifecycle into frameworks or app runtimes;
- build observability/reporting integrations on top of the supported package surface;
- run the proof lanes against their own infrastructure and AWS accounts.

Use this guide when the built-in package surface is close to what you need, but you want one more layer of composition without forking the repo.

## Extension philosophy

The extension rules are simple:

- stay SNS/SQS-specific
- prefer composition over changing `core`
- extend through supported imports only
- keep framework-specific code out of the runtime core
- keep provisioning, IAM, and domain contracts outside the shared package

Do not extend the package by deep-importing internal files from `dist/` or `src/`. If the supported imports are not enough, that is either:

- a gap that belongs in a tracked issue; or
- a sign that the code should stay consumer-owned instead of moving into the shared package

## Supported extension seams

These are the current package seams intended for safe extension:

| Seam | When to use it | What it should own |
| --- | --- | --- |
| `SqsRuntimeClient` | You need to wrap receive/delete/visibility behavior for workers | recording clients, fault injection, AWS-compatible runtime wrappers |
| `SqsTransportClient` | You need to wrap queue resolution or SQS publishing/batch operations | publisher instrumentation, helper composition, transport shims |
| `SqsQueueOperationsClient` | You need queue inspection or native redrive wrappers | admin/runbook helpers, smoke harness wrappers |
| `SnsTransportClient` | You need topic resolution or SNS publishing wrappers | topic helper composition, publish instrumentation |
| root package helpers | You want convenience APIs without changing runtime semantics | publisher wrappers, route-factory wrappers, forwarding composition |
| `SqsWorkerServiceLifecycle` | You want framework or process lifecycle integration | app-runtime bridges, service startup/shutdown glue |
| `@idenstra/messaging-runtime/observability` | You want OTEL or vendor-specific wiring | metrics/tracing composition, backend wiring, wrappers |

Supported imports remain:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

## Adapter patterns

### Wrapped and recording clients

The most common extension pattern is to wrap an existing adapter or capability client and delegate to it.

Use this when you want:

- smoke-test recording
- fault injection
- lightweight instrumentation
- AWS-compatible endpoint swapping
- extra validation around request construction

Prefer wrapping the narrowest capability surface you need:

- use `SqsRuntimeClient` when the wrapper is only for worker-core calls
- use `SqsTransportClient` when the wrapper is for queue resolution or publish/send flows
- use `SqsQueueOperationsClient` when the wrapper is for queue inspection or redrive paths
- use `SnsTransportClient` when the wrapper is for topic resolution or SNS publishing

If the same wrapper really needs several capabilities, combine them intentionally instead of inventing a transport-neutral interface.

See the compile-checked example:

- [`../examples/extensions/recording-transport-and-helper.ts`](../examples/extensions/recording-transport-and-helper.ts)

### AWS-compatible and emulator-backed adapters

The package does not require that the backing client be the exact AWS SDK implementation, only that it satisfies the capability contract.

Good fits:

- LocalStack-backed SDK clients
- fake clients for tests
- recording wrappers around real AWS SDK clients
- AWS-compatible endpoints that preserve SNS/SQS semantics well enough for the specific capability being used

Bad fits:

- adapters that erase SNS/SQS semantics behind generic `BrokerClient` contracts
- wrappers that silently reinterpret visibility, ack, or redrive behavior into another transport model

## Helper-layer patterns

Consumer-owned helper layers are encouraged when they stay transport-native.

Good examples:

- serializer or schema-validation wrappers around `SqsPublisher` or `SnsPublisher`
- route-factory convenience wrappers built on top of `sqsJsonRoute(...)`, `snsJsonQueueRoute(...)`, or `sqsStringRoute(...)`
- queue-ops helper classes that compose `SqsQueueInspector`, `SqsQueueDiscovery`, or `SqsDlqRedriveManager`
- small forwarding or policy wrappers that remain SNS/SQS-native

These helpers should:

- use supported imports only
- keep AWS field semantics visible
- avoid inventing transport-neutral route or message contracts
- keep domain payload contracts in the consuming system

See the compile-checked example:

- [`../examples/extensions/recording-transport-and-helper.ts`](../examples/extensions/recording-transport-and-helper.ts)

## Framework and process integration patterns

The runtime core should stay framework-agnostic. Framework or process lifecycle glue belongs on top of `SqsWorkerServiceLifecycle`.

That interface is the safe seam for:

- startup hooks
- shutdown hooks
- health/readiness snapshots
- integration into app-managed service runners

Nest is the existing concrete adapter, but it is not the only allowed pattern. A Fastify app, Hono app, custom process runner, or internal service container can all bridge the same lifecycle without changing worker semantics.

The rule is:

- `core` owns SNS/SQS runtime behavior
- adapters own lifecycle glue
- adapters must not create runtime-semantic divergence

See the compile-checked example:

- [`../examples/extensions/lifecycle-bridge.ts`](../examples/extensions/lifecycle-bridge.ts)

## Observability layering

`@idenstra/messaging-runtime/observability` is the intended seam for OTEL and vendor-specific observability composition.

Welcomed patterns here:

- meter/tracer wrapper factories
- backend wiring for OTLP exporters
- SigNoz, Datadog, or other backend-specific setup docs in downstream repos
- app-specific metric/static-attribute composition
- trace-context helper composition

Keep the boundary explicit:

- the package owns OTEL-first helpers
- exporter/backend choices stay consumer-owned
- backend-specific runtime code should not leak into `core`

## Placement rules

Use these rules before proposing a new shared feature.

### Put it in `core` only when:

- it changes real worker runtime behavior
- it is SNS/SQS-specific
- it has clear timeout/ack/failure semantics
- it belongs in the worker manager/route model rather than in app composition

### Put it on the root package surface when:

- it is a transport/helper convenience layer
- it composes over supported runtime or transport seams
- it is useful across consumers without importing framework-specific dependencies

### Put it in `observability` or `nest` when:

- it is specifically an OTEL/tracing/metrics concern; or
- it is specifically a framework lifecycle/logger concern

### Keep it consumer-owned when:

- it depends on domain contracts
- it depends on provisioning, IAM, or infrastructure policy management
- it is an app-specific workflow or admin command
- it needs private repo conventions or private infrastructure context

## Welcomed vs rejected extensions

### Welcomed

- serializers and schema-validation wrappers
- route-factory convenience wrappers that stay SNS/SQS-native
- publisher convenience wrappers that stay SNS/SQS-native
- OTEL or vendor-specific observability wiring
- error-reporting wrappers such as Sentry-like integrations
- LocalStack, fake-client, and recording-client helpers
- framework/process lifecycle adapters built over `SqsWorkerServiceLifecycle`
- fork-owned workflow or AWS smoke wiring for another AWS account

### Rejected

- Kafka transport implementations
- RabbitMQ transport implementations
- Redis stream transport implementations
- generic `BrokerMessage`, transport-neutral ack abstractions, or cross-transport route models
- queue/topic provisioning and IAM/policy management APIs
- app/domain message contracts
- private consumer examples that require sibling repos to understand the pattern

## Contribution rules

Extension-facing contributions should follow these rules:

- stay on supported imports only
- do not require deep imports into package internals
- do not add transport-neutral abstractions
- do not weaken current proof expectations
- keep examples generic and copy-pasteable
- document welcomed and rejected extension boundaries in the same change set

For transport/runtime changes, the repo proof expectation still applies:

- deterministic harness first
- LocalStack proof when behavior is end-to-end
- observability proof when OTEL/tracing behavior changes
- live AWS smoke when the change depends on real AWS semantics

## Existing example inventory

Use the existing examples as building blocks before inventing new abstractions:

- route factories: [`../examples/route-factories/common-routes.ts`](../examples/route-factories/common-routes.ts)
- forwarding helpers: [`../examples/forward-handlers/relay-workers.ts`](../examples/forward-handlers/relay-workers.ts)
- worker lifecycle: [`../examples/worker-lifecycle/`](../examples/worker-lifecycle/)
- observability: [`../examples/observability/otel-signoz-worker.ts`](../examples/observability/otel-signoz-worker.ts)
- queue ops: [`../examples/queue-ops/native-dlq-redrive.ts`](../examples/queue-ops/native-dlq-redrive.ts)

If one of those examples is close to your use case, prefer wrapping it in your repo instead of asking the shared package to own your app-specific policy.
