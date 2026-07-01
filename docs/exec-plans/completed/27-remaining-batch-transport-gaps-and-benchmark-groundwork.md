# `#27` Remaining batch transport gaps and benchmark groundwork

## Summary

Implement the remaining SNS/SQS batch transport gaps while explicitly keeping worker-core batching out of scope for now.

This slice also adds the first real benchmark command surface and tracked baseline artifacts so later throughput work can be evidence-based.

## Implementation changes

- realign `#27` and `#10` so:
  - `#27` owns the remaining batch transport gaps plus benchmark groundwork
  - `#10` stays open for buffered prefetch and any later worker-core throughput redesign
- add SQS batch transport support for:
  - `DeleteMessageBatch`
  - `ChangeMessageVisibilityBatch`
- add SNS batch transport support for:
  - `PublishBatch`
- extend `AwsSqsAdapter` and `AwsSnsAdapter` with the new batch operations
- add high-level helper surfaces:
  - `SqsMessageBatchOperator.deleteMessages(...)`
  - `SqsMessageBatchOperator.changeMessageVisibility(...)`
  - `SnsPublisher.publishJsonBatch(...)`
- keep caller-facing batch IDs stable and hide AWS batch-entry remapping internally
- keep worker-core behavior unchanged:
  - no batched delete in `SqsWorkerManager`
  - no batched heartbeat/visibility extension
  - no buffered prefetch or dispatch-loop redesign
- add benchmark command surface:
  - `npm run benchmark`
  - `npm run benchmark:ci`
  - maintainer baseline refresh helper if needed
- add tracked benchmark baseline artifacts under `docs/benchmarks/`
- update package docs, changelog, and public-surface artifacts for the new batch capabilities and benchmark posture

## Test plan

- adapter delegation coverage for:
  - `DeleteMessageBatch`
  - `ChangeMessageVisibilityBatch`
  - `PublishBatch`
- helper coverage for:
  - chunking above AWS 10-entry limits
  - duplicate caller ID rejection
  - queue/topic resolution reuse
  - normalized partial-success / partial-failure results
  - FIFO field forwarding for SNS batch publish
  - per-entry visibility timeout forwarding for SQS batch visibility updates
- regression coverage for existing `SqsPublisher.sendJsonBatch(...)`
- benchmark smoke proof through:
  - `npm run benchmark`
  - `npm run benchmark:ci`
- full proof:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- this slice closes `#27`
- this slice does not close `#10`
- any worker-core batching decision is deferred until benchmark results exist
- no new public subpaths are added
- no provisioning or queue/topic lifecycle APIs are introduced here
