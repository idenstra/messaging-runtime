# `#28` Read-only queue/topic discovery and cross-account SQS resolution

## Summary

Add typed cross-account SQS queue-name resolution, page-first read-only queue/topic discovery helpers, and the adapter/docs/public-surface updates needed to keep the package transport-focused without drifting into provisioning ownership.

## Implementation changes

- extend `SqsQueueUrlResolver` with:
  - `resolve(string | { queue, ownerAccountId? })`
  - typed preload entries for cross-account queue-name mappings
  - owner-aware cache keys so same-name queues in different accounts do not collide
- add read-only discovery helpers:
  - `SqsQueueDiscovery.listQueues(...)`
  - `SnsTopicDiscovery.listTopics(...)`
- extend `AwsSqsAdapter` with `ListQueues` delegation
- add transport tests for:
  - typed owner-account queue resolution
  - typed preload entries
  - page-first queue discovery
  - page-first topic discovery
- update package docs and checked-in public-surface artifacts to reflect the new helpers and the cross-account resolution contract

## Test plan

- transport tests cover:
  - existing string queue name/URL/ARN resolution
  - typed owner-account queue-name resolution
  - invalid owner-account input rejection
  - no-cache collision across same-name queues in different accounts
  - queue discovery pagination and normalization
  - topic discovery pagination and normalization
- full proof:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- cross-account support stays SQS-resolution-only in this slice
- `ListQueues` remains same-account and same-region because that is the native AWS boundary
- topic discovery stays read-only and minimal; it does not add client-side filtering or provisioning behavior
