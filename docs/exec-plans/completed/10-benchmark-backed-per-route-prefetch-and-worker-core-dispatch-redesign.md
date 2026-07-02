# `#10` Benchmark-backed per-route prefetch and worker-core dispatch redesign

## Summary

Implement the first worker-core throughput redesign slice with benchmark proof, while keeping the behavior bounded and transparent by default.

Locked decisions:
- optimize first for a few hot queues rather than many mixed routes
- use a per-route bounded prefetch buffer
- keep buffered entries raw until dispatch time
- add route-local delete batching in the worker core
- keep heartbeat and visibility extension behavior per message
- expose buffered state through snapshots and OTEL snapshot-derived gauges
- keep the rollout transparent with no new public config knobs in this slice

## Implementation changes

- rewrite issue `#10` so it owns both the benchmark-backed evaluation and the implementation path
- add a bounded per-route raw-message buffer capped by:
  - `min(concurrency, maxMessagesPerPoll)`
- change route polling demand so the worker can prefetch ahead of available handler slots for hot queues
- keep decode at dispatch time instead of at receive time
- add a buffered-message visibility-age guard:
  - if a buffered message has consumed 50% or more of the configured visibility timeout before dispatch
  - extend visibility once before handler invocation
- keep route ownership isolated:
  - no shared scheduler
  - no cross-route backlog
  - no process-wide fairness policy
- add route-local delete batching in `SqsWorkerManager`:
  - flush at 10 entries
  - or after a 5ms coalescing window
  - or during stop/drain
- retry failed batch-delete entries once with individual `DeleteMessage`
- surface buffered state publicly through:
  - per-route `buffered`
  - manager `totalBuffered`
  - OTEL snapshot gauges for buffered counts
- extend deterministic benchmark coverage for:
  - hot-queue prefetch throughput
  - prefetch plus delete-batch finalization
  - stop/drain with buffered backlog
  - timeout behavior with buffered backlog

## Non-goals

- no shared global scheduler
- no worker-core heartbeat batching
- no worker-core `ChangeMessageVisibilityBatch`
- no new manifest or route knobs for prefetch policy
- no required emulator lane in the default harness

## Test plan

- targeted runtime tests for:
  - bounded buffer depth
  - pre-dispatch visibility guard
  - stop/drain with buffered messages
  - batch-delete size, timer, and retry behavior
  - timeout semantics with buffered backlog
- benchmark proof through:
  - `npm run benchmark`
  - `npm run benchmark:baseline`
- full proof:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- `#10` is allowed to land the redesign if the benchmark review is favorable
- this slice targets balanced throughput and cost, not maximum complexity for peak throughput
- if the bounded per-route redesign still proves insufficient, the next follow-up should evaluate a heavier shared-scheduler path
