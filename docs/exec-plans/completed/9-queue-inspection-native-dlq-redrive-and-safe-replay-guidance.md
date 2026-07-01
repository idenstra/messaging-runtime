# Execution Plan

## Summary

Implement `messaging-runtime#9` as a library-first queue-ops slice:
- add queue inspection helpers
- add native AWS DLQ redrive/list/cancel helpers
- keep manual message replay consumer-owned and document the safe recovery boundary

## Implementation changes

- add a root-exported queue-ops surface with:
  - `SqsQueueOperationsClient`
  - `SqsQueueInspector`
  - `SqsDlqRedriveManager`
  - typed queue snapshot and redrive task shapes
- extend `AwsSqsAdapter` to implement queue-ops/admin methods in addition to runtime and transport methods
- add a consumer-owned queue-ops example script plus compile-proof coverage
- update consumer docs and public-surface artifacts to reflect the new queue-ops surface
- refine issue `#9` so “replay” explicitly means native redrive plus documented consumer-owned manual replay

## Test plan

- add queue-ops unit coverage for inspection, source-queue pagination, redrive start/list/cancel, and guardrails
- extend adapter coverage so AWS queue-ops command delegation is proven
- compile-check the example script against the supported public imports
- run:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- v1 queue ops stays library-first; no package-owned CLI
- manual replay remains consumer-owned because idempotency rules are domain-specific
- the root package import surface stays unchanged
