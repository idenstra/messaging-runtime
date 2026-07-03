# Runtime semantics

This document defines the behavior that consumers depend on when running SQS workers.

## Message lifecycle

For each active route, the runtime loops through this lifecycle:

1. resolve the configured queue identifier to a queue URL;
2. long-poll SQS with route demand that covers both in-flight slots and bounded prefetch;
3. store received messages in a per-route raw buffer;
4. when a handler slot is available, convert the next raw message into a runtime message;
5. decode the payload through the route decoder or the built-in JSON body decoder;
6. call the route handler;
7. apply the success, failure, or timeout ack policy;
8. update counters, status fields, and runtime events.

A message is removed from SQS only when the runtime completes delete finalization. Otherwise, SQS redelivers it after the visibility timeout expires, subject to the queue redrive policy.

## Worker message shape

Handlers receive two views of AWS system attributes:

- `message.attributes`
  - the raw AWS `Attributes` string map preserved as returned by SQS
- `message.systemAttributes`
  - the typed runtime view for the most commonly consumed worker fields

The typed view preserves AWS field names and parses selected values:

- `ApproximateReceiveCount` -> `number`
- `ApproximateFirstReceiveTimestamp` -> `Date`
- `SentTimestamp` -> `Date`
- `SenderId`, `MessageGroupId`, `MessageDeduplicationId`, `SequenceNumber`, `AWSTraceHeader`, and `DeadLetterQueueSourceArn` -> `string`

Use `message.systemAttributes` in handler logic, and fall back to `message.attributes` only when you need raw compatibility or an untyped AWS field that the runtime does not normalize yet.

For example, duplicate-sensitive handlers can gate retries using `ApproximateReceiveCount` without reparsing strings:

```ts
handle: async ({ message, payload }) => {
  const receiveCount = message.systemAttributes.ApproximateReceiveCount ?? 1;
  if (receiveCount > 3) {
    throw new Error(`stopping retries for ${payload.jobId}`);
  }
}
```

Invalid integer or timestamp system-attribute values fail worker-message normalization clearly. That is intentional: emulator drift or service-contract regressions should surface as runtime errors, not be silently ignored.

## Default route config

| Field | Default | Meaning |
| --- | ---: | --- |
| `concurrency` | `4` | Maximum in-flight handler calls for the route. |
| `waitTimeSeconds` | `20` | SQS long-poll wait time. |
| `visibilityTimeoutSeconds` | `60` | Visibility timeout requested during receive and heartbeat. |
| `heartbeatIntervalMs` | `20_000` | Interval for visibility extension. Set `0` to disable interval heartbeat. |
| `emptyReceiveDelayMs` | `250` | Delay after an empty receive. |
| `errorBackoffMs` | `1_000` | Delay after a polling error. |
| `maxMessagesPerPoll` | `10` | Maximum messages requested per receive call. SQS caps this at `10`. |
| `handlerTimeoutMs` | unset | No handler timeout unless configured. |
| `timeoutStrategy` | `cooperative` | Timeout strategy when `handlerTimeoutMs` is set. |
| `failureAction` | `keep` | Default action after decode, handler, or timeout failure. |

Config is merged in this order:

1. runtime defaults;
2. manager or manifest defaults;
3. route config;
4. manifest route config.

The later value wins.

## FIFO ReceiveRequestAttemptId policy

Advanced FIFO receive support is optional and off by default.

Public policy surface:

- manager defaults use `receiveDefaults`
- worker-service manifests use:
  - `receiveDefaults`
  - `routes[routeName].receive`
- route code uses `receive`
  - `policy`
  - optional `createRequestAttemptId()`

Effective precedence:

1. runtime default: `off`
2. manager `receiveDefaults`
3. manifest `receiveDefaults`
4. route `receive.policy`
5. manifest route `receive`

Supported modes:

- `off`
  - omit `ReceiveRequestAttemptId`
- `runtime`
  - the runtime generates a token
- `custom`
  - the runtime calls `route.receive.createRequestAttemptId()`

Validation and correctness rules:

- the feature is FIFO-only; enabling it on a non-FIFO queue fails locally
- `custom` mode requires a callback
- callback output must be non-empty, at most 128 characters, and valid for AWS-supported characters
- the runtime keeps one pending token per route
- the runtime reuses that token only across failed `receiveMessage` retries
- any successful receive response clears the pending token, including empty receives
- pending tokens expire after the AWS five-minute window and are replaced instead of being reused

This feature improves transport-level retry continuity only. It does not add an idempotency store or exactly-once delivery semantics, and visibility timeout plus duplicate-risk behavior still apply.

## Prefetch and buffer behavior

The runtime now keeps a bounded raw-message prefetch buffer per route.

- buffer depth is capped at `min(concurrency, maxMessagesPerPoll)`
- `buffered` counts only prefetched backlog, not newly received messages that can start immediately in free handler slots
- buffered entries remain raw until dispatch time
- route demand is calculated from:
  - configured concurrency
  - prefetch limit
  - current in-flight work
  - current buffered count

This is intentionally route-local:
- no shared scheduler
- no cross-route backlog
- no many-route fairness policy in this slice

### Buffered visibility-age protection

Because buffered messages start their SQS visibility window when they are received, the runtime protects older buffered entries before dispatch:

- each buffered entry tracks receive time
- if a buffered message has already consumed 50% or more of the configured visibility timeout while waiting locally
- the runtime extends visibility once before invoking the handler

If that pre-dispatch visibility extension fails, the runtime drops the local buffered copy, records the infrastructure error, and lets SQS redeliver the message later through the queue's normal visibility/redrive behavior.

The runtime now emits two explicit infrastructure events on that path:

- `pre-dispatch-visibility-failure`
- `buffered-message-drop`

## Ack behavior

Handlers may return either no value or an object with an `action` field.

```ts
return { action: 'delete' };
return { action: 'keep' };
```

Success default:

- no return value means `delete`;
- `{ action: 'delete' }` deletes the message;
- `{ action: 'keep' }` keeps the message for SQS redelivery.

Worker-core delete finalization is route-local and batched:

- deletes are coalesced per route with `DeleteMessageBatch`
- a flush happens at:
  - local route idle transition with no buffered backlog
  - 10 entries
  - 5ms coalescing window
  - stop/drain
- failed batch-delete entries retry once through individual `DeleteMessage`
- if the retry still fails, the runtime records the infrastructure error and accepts duplicate-risk redelivery instead of retrying forever

Delete finalization infrastructure failures are now first-class runtime events:

- `delete-batch-failure`
- `message-delete-failure`

Failure default:

- decode, handler, and timeout failures use the route `failureAction`;
- the default `failureAction` is `keep`;
- `onError` can return `delete` or `keep` to override the route default;
- invalid `onError` return values are ignored and the route default is used;
- if `onError` throws, the route default is used.

## Decode failures

If a route does not provide `decodePayload`, the built-in decoder parses the SQS body as JSON. Routes may override that with an explicit decoder when they want stronger typing, extra validation, or a non-default payload shape. Decode failure means the handler is not called.

A decode failure is still eligible for the route failure policy. Use `failureAction: 'delete'` only when malformed messages are intentionally disposable or are already captured elsewhere.

## Handler failures

Unhandled handler exceptions are passed to the route error hook when one is configured.

```ts
const route = {
  name: 'jobs',
  handle: async () => {
    throw new Error('boom');
  },
  onError: async ({ failureKind, error }) => {
    if (failureKind === 'handler') {
      console.error(error);
    }
    return 'keep';
  },
};
```

## Timeout behavior

Timeouts are opt-in through `handlerTimeoutMs`.

### Cooperative timeout

`timeoutStrategy: 'cooperative'` aborts the handler through `abortSignal`, keeps the runtime slot occupied, continues the heartbeat, waits for the handler promise to settle, then applies the timeout failure action.

Use this when handlers are expected to observe `abortSignal` and clean up safely.

### Abandon timeout

`timeoutStrategy: 'abandon'` aborts the handler, stops heartbeats, applies a keep-only timeout finalization, frees the runtime slot, and observes the late handler settlement asynchronously.

Use this only when the worker must free capacity quickly and duplicate processing is acceptable. The runtime will not delete a message after abandon timeout finalization.

## Heartbeats

The runtime extends message visibility by calling `ChangeMessageVisibility` with the configured `visibilityTimeoutSeconds`.

Heartbeat sources:

- interval heartbeat, controlled by `heartbeatIntervalMs`;
- manual heartbeat, exposed to handlers as `heartbeat()`.

A heartbeat failure is recorded and emitted as an event. Handler code should treat manual heartbeat failure as a signal that the message may become visible again.

## Shutdown behavior

`runSqsWorkerServiceUntilSignal` listens for stop signals, calls `host.stop()`, removes signal listeners, and waits for stop completion.

Worker manager shutdown does the following:

1. marks routes as stopping;
2. aborts in-flight long polls;
3. drains any locally buffered messages instead of abandoning them;
4. waits for route loops to finish;
5. waits for in-flight tasks to settle according to their timeout strategy;
6. flushes pending delete batches before returning.

A cooperative timeout can extend shutdown until the timed-out handler settles. An abandon timeout can finish shutdown sooner because the runtime does not wait for the late handler before releasing the slot.

## Runtime events

The runtime emits events for:

- `receive-empty`
- `poll-error`
- `messages-received`
- `handler-start`
- `handler-success`
- `handler-failure`
- `handler-timeout`
- `late-settlement`
- `message-delete`
- `delete-batch-failure`
- `message-delete-failure`
- `pre-dispatch-visibility-failure`
- `buffered-message-drop`
- `message-keep`
- `heartbeat-success`
- `heartbeat-failure`

Event hooks must not affect message processing. If the hook throws, the runtime logs a warning and continues.

## Snapshots

Use `getSnapshot()` for health and readiness integrations. It includes:

- started and stopping state;
- route count;
- total in-flight count;
- total buffered count;
- aggregate counters;
- per-route status and counters;
- per-route buffered count;
- last receive, success, failure, timeout, delete, keep, heartbeat, and late-settlement timestamps when available;
- explicit last-occurrence fields for:
  - polling failures
  - delete-batch failures
  - individual delete failures
  - pre-dispatch visibility failures
  - buffered-message drops

Snapshots are process-local. They are not a distributed metric store.
