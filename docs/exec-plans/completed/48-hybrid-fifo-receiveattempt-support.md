# `messaging-runtime#48` Execution Plan: Hybrid FIFO ReceiveAttempt Support

## Summary

Add advanced FIFO `ReceiveRequestAttemptId` support with:

- serializable receive-policy knobs in manager defaults and worker-service manifests
- code-owned custom token generation on the route
- fixed runtime-managed reuse, reset, and expiry behavior

Locked behavior:

- the feature is opt-in and off by default
- only FIFO queues may enable it
- custom mode requires a route callback
- successful receives clear the pending token
- failed receive retries reuse the same token only inside the AWS five-minute window

## Implementation Changes

- add `SqsWorkerReceivePolicy` and `SqsWorkerReceiveStrategy`
- extend `SqsWorkerRoute`, `SqsWorkerManagerOptions`, and worker-service manifest shapes with receive policy support
- merge receive policy with documented precedence across manager defaults, manifest defaults, route policy, and manifest route policy
- implement runtime-managed token lifecycle for `off`, `runtime`, and `custom` modes
- validate FIFO-only usage and callback/token correctness locally before AWS calls
- update package docs and public-surface artifacts so the new receive contract is explicit

## Test Plan

- default mode omits `ReceiveRequestAttemptId`
- runtime mode generates a token for FIFO routes
- failed receive retries reuse the same token
- successful receives clear the pending token
- expired tokens are replaced instead of reused
- non-FIFO enablement and invalid custom-mode usage fail clearly
- host manifest receive defaults and per-route receive policy merge correctly

## Assumptions

- only mode selection is configurable; token reuse/expiry/reset rules stay runtime-owned
- this feature improves transport retry continuity only and does not change duplicate-risk or idempotency semantics
