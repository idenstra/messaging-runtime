# messaging-runtime

`messaging-runtime` is Idenstra's dedicated private-first home for the shared TypeScript SNS/SQS messaging runtime.

Current state:
- single package surface: `@idenstra/messaging-runtime`
- root entrypoint exposes the worker runtime core plus SNS/SQS transport helpers
- Nest integration is exposed as the optional subpath `@idenstra/messaging-runtime/nest`
- extracted worker runtime core now lives here
- route-level failure policy and error hooks now live in the core runtime
- handler timeout control and runtime metrics/snapshot hooks now live in the core runtime
- root-exported SNS/SQS translators, cached resolvers, and JSON publisher helpers now live here
- resolver config may be preloaded by the consumer at startup; the library does not read env/files directly
- no business handlers live here
- consumer adoption is still deferred until later slices

## Purpose

This repo will own:
- the shared SNS/SQS polling/runtime core
- route-level failure policy and timeout control
- lightweight runtime event hooks and health/readiness snapshots
- SNS/SQS-specific publisher and envelope helpers
- worker host/bootstrap ergonomics for app-owned worker services
- package-level tests and verification for the shared runtime

This repo will not own:
- `CDP` communication handlers
- app-specific persistence or SES business logic
- generic broker abstractions across unrelated transports

## Quick start

```bash
npm ci
npm test
npm run build
make audit
make verify-fast
make verify
```

## Transport helpers

Decode a plain SQS JSON body:

```ts
import { decodeSqsJsonBody } from '@idenstra/messaging-runtime';

const payload = decodeSqsJsonBody<{ tenantId: string }>(message.body);
```

Decode an SNS notification delivered through SQS:

```ts
import { decodeSnsNotificationJson } from '@idenstra/messaging-runtime';

const { envelope, payload } = decodeSnsNotificationJson<{ eventType: string }>(message.body);
```

Resolve queue or topic identifiers and publish JSON:

```ts
import {
  AwsSnsTransportClient,
  AwsSqsTransportClient,
  SnsPublisher,
  SqsPublisher,
} from '@idenstra/messaging-runtime';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

const sqsPublisher = new SqsPublisher(new AwsSqsTransportClient(new SQSClient({ region: 'us-east-1' })));
await sqsPublisher.sendJson({
  queue: 'dispatch-queue',
  payload: { tenantId: 'tenant-1', recipientId: 'recipient-1' },
});

const snsPublisher = new SnsPublisher(new AwsSnsTransportClient(new SNSClient({ region: 'us-east-1' })));
await snsPublisher.publishJson({
  topic: 'idenstra-email-events',
  payload: { eventType: 'DELIVERY' },
});
```

Preload resolver mappings from worker/app config:

```ts
import { SqsQueueUrlResolver, SqsPublisher, AwsSqsTransportClient } from '@idenstra/messaging-runtime';
import { SQSClient } from '@aws-sdk/client-sqs';

const sqsClient = new AwsSqsTransportClient(new SQSClient({ region: 'us-east-1' }));
const queueResolver = new SqsQueueUrlResolver(sqsClient, {
  preload: {
    'dispatch-queue': 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  },
  allowNetworkLookup: false,
});

const publisher = new SqsPublisher(sqsClient, queueResolver);
```

Configuration boundary:
- apps/workers may load queue/topic mappings from env, files, manifests, or secrets before boot
- `messaging-runtime` does not load config sources directly
- resolver caches are only process-local memoization layered on top of injected config and lookups

Current migration seam:
- `CDP` still contains direct SQS dispatch publishing and SNS-over-SQS parsing
- `platform` still contains a separate SNS-over-SQS parser in the SES ops-event archiver
- moving those consumers onto this package is intentionally a later slice

## Canonical docs

- [AGENTS.md](AGENTS.md)
- [WORKFLOW.md](WORKFLOW.md)
- [docs/HARNESS.md](docs/HARNESS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EXECUTION_PLANS.md](docs/EXECUTION_PLANS.md)
- [docs/ISSUE_TRACKING.md](docs/ISSUE_TRACKING.md)

## Packaging posture

- package name: `@idenstra/messaging-runtime`
- registry posture: GitHub Packages, private-first
- package publication is intentionally blocked in the current extraction phase
- version posture: `0.x`
- OSS readiness is explicitly deferred
- release/publication policy is formalized later under `#7`
