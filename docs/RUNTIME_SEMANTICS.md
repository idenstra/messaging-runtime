# Runtime semantics

This document defines the behavior that consumers depend on when running SQS workers.

## Message lifecycle

For each active route, the runtime loops through this lifecycle:

1. resolve the configured queue identifier to a queue URL;
2. long-poll SQS with the route capacity still available;
3. convert each raw SQS message into a runtime message;
4. decode the payload;
5. call the route handler;
6. apply the success, failure, or timeout ack policy;
7. update counters, status fields, and runtime events.

A message is removed from SQS only when the runtime calls `DeleteMessage`. Otherwise, SQS redelivers it after the visibility timeout expires, subject to the queue redrive policy.

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

Failure default:

- decode, handler, and timeout failures use the route `failureAction`;
- the default `failureAction` is `keep`;
- `onError` can return `delete` or `keep` to override the route default;
- invalid `onError` return values are ignored and the route default is used;
- if `onError` throws, the route default is used.

## Decode failures

The default decoder parses the SQS body as JSON. Decode failure means the handler is not called.

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
3. waits for route loops to finish;
4. waits for in-flight tasks to settle according to their timeout strategy.

A cooperative timeout can extend shutdown until the timed-out handler settles. An abandon timeout can finish shutdown sooner because the runtime does not wait for the late handler before releasing the slot.

## Runtime events

The runtime emits events for:

- `receive-empty`
- `messages-received`
- `handler-start`
- `handler-success`
- `handler-failure`
- `handler-timeout`
- `late-settlement`
- `message-delete`
- `message-keep`
- `heartbeat-success`
- `heartbeat-failure`

Event hooks must not affect message processing. If the hook throws, the runtime logs a warning and continues.

## Snapshots

Use `getSnapshot()` for health and readiness integrations. It includes:

- started and stopping state;
- route count;
- total in-flight count;
- aggregate counters;
- per-route status and counters;
- last receive, success, failure, timeout, delete, keep, heartbeat, and late-settlement timestamps when available.

Snapshots are process-local. They are not a distributed metric store.
