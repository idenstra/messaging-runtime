# Performance

Performance is a product requirement for this package. It should be lightweight, predictable, and cheap to run.

The repository now owns a deterministic benchmark suite and checked-in baseline artifacts. That closes the "no benchmark evidence at all" gap, but it does not justify strong comparative marketing claims yet. The correct posture remains: performance is a design goal, benchmark methodology exists, and worker-core throughput changes should be benchmark-backed before they land.

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

1. SQS batch publish chunking and result aggregation.
2. SNS batch publish chunking and result aggregation.
3. single-message delete finalization.
4. single-message heartbeat/visibility finalization.
5. current single-route full-batch receive and dispatch behavior.

The broader hot paths that still deserve additional benchmark coverage are:

1. SQS receive loop scheduling under empty, partial, and mixed batches.
2. message conversion from AWS SDK shape to runtime message shape.
3. JSON body decoding for plain SQS messages.
4. SNS envelope decoding and nested payload decoding.
5. handler dispatch and ack action resolution.
6. failure-keep finalization and timeout paths.
7. resolver cache hit and miss paths.
8. snapshot generation with many routes and high counter volume.

## Benchmark command surface

The benchmark suite runs locally without live AWS:

```bash
npm run benchmark
npm run benchmark:ci
npm run benchmark:baseline
```

- `benchmark` prints the current human-readable report.
- `benchmark:ci` emits stable machine-readable JSON and is safe for the mandatory harness.
- `benchmark:baseline` refreshes the tracked baseline artifacts after an intentional benchmark change.

## Current benchmark scenarios

The current suite includes:

| Benchmark | Measures |
| --- | --- |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation overhead. |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation overhead. |
| `worker:ack-delete` | Delete-message finalization overhead with fake client. |
| `worker:visibility-heartbeat` | Manual heartbeat plus keep finalization overhead with fake client. |
| `worker:single-route-full-batch` | Current full-batch receive and dispatch overhead. |

Future scenarios still worth adding:

| Benchmark | Measures |
| --- | --- |
| `decode:sqs-json` | Plain SQS JSON body decode throughput and allocation. |
| `decode:sns-over-sqs-json` | SNS envelope and nested JSON payload decode throughput. |
| `worker:many-routes-empty-poll` | Scheduling overhead with many routes and empty receives. |
| `worker:failure-keep` | Failure hook plus keep finalization overhead. |
| `worker:timeout-cooperative` | Timeout handling overhead and slot retention behavior. |
| `resolver:cache-hit` | Queue/topic resolver cache-hit cost. |
| `snapshot:many-routes` | Snapshot generation cost with route/counter aggregation. |

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
