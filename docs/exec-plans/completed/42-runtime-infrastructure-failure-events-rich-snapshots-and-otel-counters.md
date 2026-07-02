# #42 Runtime Infrastructure Failure Events, Rich Snapshots, and OTEL Counters

## Summary

Close the observability gap for infrastructure failures that were previously log-only or only reflected through generic `lastError*` fields.

Locked behavior:
- add explicit runtime events for polling, delete-finalization, and buffered pre-dispatch visibility failures
- add rich snapshot/status fields for those failure paths
- keep current worker semantics unchanged
- keep OTEL attributes low-cardinality

## Implementation Changes

- Extend the public runtime-event surface with:
  - `poll-error`
  - `delete-batch-failure`
  - `message-delete-failure`
  - `pre-dispatch-visibility-failure`
  - `buffered-message-drop`
- Extend counters and per-route status with explicit tracking for those failure paths while preserving generic `lastErrorAt` / `lastErrorMessage`.
- Emit infrastructure events at the exact existing failure points:
  - `receiveMessage` polling failure
  - aged buffered message pre-dispatch visibility failure
  - buffered message drop before dispatch
  - batched delete request failure
  - batched delete response failure
  - individual delete retry failure
- Extend the OTEL metrics adapter with counters for the new failure events and only low-cardinality attributes.
- Update runtime semantics, observability, features, and operations docs so the new event and snapshot contract is explicit.

## Test Plan

- polling failure emits `poll-error`, preserves backoff, and updates rich snapshot fields
- batch delete request failure emits one `delete-batch-failure` and retries each message individually once
- batch delete response failure emits one `delete-batch-failure` and retries only failed entries
- individual delete retry failure emits `message-delete-failure` and does not emit `message-delete` for that message
- pre-dispatch visibility failure emits both `pre-dispatch-visibility-failure` and `buffered-message-drop`
- missing buffered receipt handle emits only `buffered-message-drop`
- manager and route snapshots include the new counters and last-occurrence fields
- OTEL mapping covers the new events and keeps runtime behavior resilient to adapter failures

## Assumptions

- This slice is observability-only and does not change retry policy or ack semantics.
- `buffered-message-drop` is the generic local-drop signal; `pre-dispatch-visibility-failure` is the narrower transport failure that can precede it.
- Rich snapshot expansion is intentional so operators can diagnose these failures without OTEL or log scraping.
