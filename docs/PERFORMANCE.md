# Performance

Performance is a product requirement for this package. It should be lightweight, predictable, and cheap to run.

The repository now owns a deterministic benchmark suite and checked-in baseline artifacts. That closes the "no benchmark evidence at all" gap, but it does not justify strong comparative marketing claims yet. The correct posture remains: performance is a design goal, benchmark methodology exists, and worker-core throughput changes should be benchmark-backed before they land.

The checked-in baseline is historical context, not the acceptance source of truth for throughput-sensitive pull requests. A slower or faster machine can make a true improvement look like a regression or vice versa. The acceptance discipline for performance-sensitive changes is same-machine A/B comparison.

The current worker-core slice implements bounded per-route prefetch and route-local batched delete finalization. That redesign is intentionally narrow:
- optimize first for a few hot queues
- keep complexity bounded
- keep the rollout transparent with no new public tuning knobs
- leave a heavier shared-scheduler path for a later issue only if evidence demands it

## Performance principles

- Keep the hot path SNS/SQS-specific.
- Avoid generic broker abstractions in runtime code.
- Avoid framework dependencies in the core path.
- Prefer explicit small interfaces over reflective or dynamic dispatch.
- Keep message decode and ack decisions allocation-conscious.
- Keep polling, handler execution, heartbeat, and shutdown behavior observable.
- Benchmark with fake clients first, then optional emulator or live AWS lanes.

## Current hot paths

The current benchmark suite covers:

1. plain SQS JSON body decode.
2. SNS-over-SQS envelope plus nested JSON payload decode.
3. SQS batch publish chunking and result aggregation.
4. SNS batch publish chunking and result aggregation.
5. resolver cache-hit and fake-client cache-miss paths.
6. single-message delete finalization.
7. single-message heartbeat/visibility finalization.
8. current single-route full-batch receive and dispatch behavior.
9. many-route empty-poll scheduling overhead.
10. single-route hot-queue throughput with bounded prefetch.
11. single-route hot-queue throughput with bounded prefetch plus delete batching.
12. failure-keep finalization.
13. stop/drain behavior with buffered backlog.
14. cooperative-timeout behavior with buffered backlog.
15. abandon-timeout handling with late settlement.
16. snapshot generation with many routes and non-zero counters.

The broader hot paths that still deserve additional benchmark coverage are:

1. SQS receive loop scheduling under empty, partial, and mixed batches.
2. message conversion from AWS SDK shape to runtime message shape.
3. handler dispatch and ack action resolution beyond the current failure/timeout coverage.
4. delete-batch partial-failure paths under throughput-oriented workloads.
5. many-route fairness tradeoffs versus the current per-route buffer design.

## Benchmark command surface

The benchmark suite runs locally without live AWS:

```bash
npm run benchmark
npm run benchmark:ci
npm run benchmark:baseline
npm run benchmark:compare -- --base /tmp/benchmark-main.json --candidate /tmp/benchmark-branch.json
```

- `benchmark` prints the current human-readable report.
- `benchmark:ci` emits stable machine-readable JSON and is safe for the mandatory harness.
- `benchmark:baseline` refreshes the tracked baseline artifacts after an intentional benchmark change has already been reviewed.
- `benchmark:compare` compares two machine-readable JSON reports and rejects environment drift by default.

Recommended performance-review workflow:

```bash
git checkout main
npm ci
npm run benchmark:ci > /tmp/benchmark-main.json

git checkout your-branch
npm ci
npm run benchmark:ci > /tmp/benchmark-branch.json

npm run benchmark:compare -- --base /tmp/benchmark-main.json --candidate /tmp/benchmark-branch.json
```

That is the preferred proof path for throughput-sensitive changes because it compares `before` and `after` on the same host, with the same Node version and benchmark settings.

## Current benchmark scenarios

The current suite includes:

| Benchmark | Measures |
| --- | --- |
| `decode:sqs-json` | Plain SQS JSON body decode throughput and allocation. |
| `decode:sns-over-sqs-json` | SNS envelope and nested JSON payload decode throughput. |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation overhead. |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation overhead. |
| `resolver:cache-hit` | Mixed SQS/SNS hot cache-hit resolution cost. |
| `resolver:cache-miss-fake-client` | Mixed SQS/SNS fake-client cache-miss resolution cost. |
| `worker:ack-delete` | Delete-message finalization overhead with fake client. |
| `worker:visibility-heartbeat` | Manual heartbeat plus keep finalization overhead with fake client. |
| `worker:single-route-full-batch` | Current full-batch receive and dispatch overhead. |
| `worker:many-routes-empty-poll` | Many-route empty-poll scheduling overhead with idle workers. |
| `worker:single-route-prefetch-hot-queue` | Hot-queue throughput with bounded per-route prefetch. |
| `worker:single-route-prefetch-delete-batch` | Hot-queue throughput with bounded per-route prefetch plus delete batching. |
| `worker:failure-keep` | Handler-failure plus keep-finalization overhead. |
| `worker:stop-drain-buffered` | Shutdown/drain behavior with a buffered message waiting behind an in-flight slot. |
| `worker:timeout-buffered-backlog` | Cooperative-timeout behavior while buffered backlog waits behind the timed-out slot. |
| `worker:abandon-timeout` | Abandon-timeout handling with late settlement after the worker slot is released. |
| `snapshot:many-routes` | Snapshot aggregation and cloning cost with many registered routes. |

Future scenarios still worth adding:

| Benchmark | Measures |
| --- | --- |
| `worker:empty-poll-partial-batch-mix` | Receive-loop behavior across empty, partial, and mixed batch responses. |
| `worker:delete-batch-partial-failure` | Delete-finalization cost when batch responses require individual retries. |
| `worker:many-routes-fairness` | Fairness tradeoffs when many queues contend for process time. |
| `message:normalize-sdk-shape` | AWS SDK message-to-runtime message normalization cost. |

## Baseline reporting

A public benchmark report should include:

- Node version;
- CPU and OS;
- package version or commit SHA;
- benchmark command;
- warmup policy;
- sample count;
- median, p95, and standard deviation where relevant;
- memory/allocation observations where relevant;
- comparison against the previous baseline.

The current tracked baseline lives at:

```text
docs/benchmarks/baseline.md
docs/benchmarks/baseline.json
```

`benchmark:ci` intentionally checks that the suite runs and emits stable output. It does not gate on fragile numeric thresholds in this slice.

The tracked baseline should be interpreted as:

- historical repository context;
- a convenient reference point for the most recently accepted benchmark posture;
- not a substitute for same-machine `before` vs `after` PR proof.

## Current acceptance posture for worker-core throughput changes

This repository does not hard-fail CI on benchmark thresholds yet. The acceptance rule is procedural:

- capture base and candidate benchmark JSON reports on the same machine;
- compare the hot-queue scenarios with `npm run benchmark:compare`;
- refresh the tracked baseline only after the change is accepted;
- do not land complexity that materially regresses the simple single-message paths without a justified tradeoff record.

For the bounded prefetch slice, the review target is:
- meaningful hot-queue improvement;
- no semantic regression in timeout, keep/delete, shutdown, or duplicate-risk handling;
- no more than modest regression on the single-message delete and heartbeat baselines.

If a future redesign cannot clear that bar, the package should prefer the simpler current behavior or open a new shared-scheduler follow-up with explicit evidence.

## Performance-proof discipline for pull requests

When a change affects worker-core throughput, polling behavior, batching, timeout handling cost, or other hot-path runtime mechanics, the pull request should include:

- the exact benchmark commands used;
- a same-machine base report path or artifact;
- a same-machine candidate report path or artifact;
- the `benchmark:compare` summary;
- explicit callouts for any intentionally added or removed scenarios.

Environment mismatch should be treated as a review smell. If a comparison must be made across different hosts for historical context, that should be called out explicitly and should not replace same-machine proof when the change is performance-sensitive.

## Optional emulator proof

The mandatory harness remains fake-client-first and deterministic.

When a maintainer wants extra confidence, run an optional emulator-backed burst test such as:

1. one hot queue with limited worker concurrency
2. a burst large enough to fill both in-flight and buffered slots
3. verification that throughput improves without breaking delete/keep or shutdown behavior

LocalStack-style proof is useful here, but it remains optional until the repository decides to own an emulator lane.

## Performance review checklist

Every runtime change should answer these questions:

- Does this add work to the receive or per-message path?
- Does this allocate per message when it could allocate per route or per poll?
- Does this introduce a framework or generic abstraction into the core path?
- Does this increase the number of promises, timers, or closures per message?
- Does this change when messages are deleted or kept?
- Does this change heartbeat frequency or visibility timeout behavior?
- Does this change shutdown latency?
- Does this need a benchmark update?

## Public claim rule

Acceptable wording now:

> Designed to be lightweight and SNS/SQS-specific, with a deterministic local benchmark suite and tracked baseline.

Still unacceptable without broader evidence:

> Blazingly fast.

> Faster than alternatives.

> Production-proven at high throughput.

The package can earn those claims only after the benchmark suite and production adoption data exist.
