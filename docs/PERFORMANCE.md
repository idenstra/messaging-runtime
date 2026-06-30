# Performance

Performance is a product requirement for this package. It should be lightweight, predictable, and cheap to run.

The repository must not claim benchmark superiority until it has a benchmark suite and published baseline numbers. Until then, the correct public posture is: performance is a design goal and an unclosed release-readiness item.

## Performance principles

- Keep the hot path SNS/SQS-specific.
- Avoid generic broker abstractions in runtime code.
- Avoid framework dependencies in the core path.
- Prefer explicit small interfaces over reflective or dynamic dispatch.
- Keep message decode and ack decisions allocation-conscious.
- Keep polling, handler execution, heartbeat, and shutdown behavior observable.
- Benchmark with fake clients first, then optional emulator or live AWS lanes.

## Current hot paths

The hot paths that need benchmark coverage are:

1. SQS receive loop scheduling under empty, partial, and full batches.
2. message conversion from AWS SDK shape to runtime message shape.
3. JSON body decoding for plain SQS messages.
4. SNS envelope decoding and nested payload decoding.
5. handler dispatch and ack action resolution.
6. delete and keep finalization.
7. heartbeat scheduling and `ChangeMessageVisibility` calls.
8. SQS batch publishing and result aggregation.
9. resolver cache hit and miss paths.
10. snapshot generation with many routes and high counter volume.

## Required benchmark suite

Add a benchmark suite before public release. It should run locally without live AWS.

Recommended scenarios:

| Benchmark | Measures |
| --- | --- |
| `decode:sqs-json` | Plain SQS JSON body decode throughput and allocation. |
| `decode:sns-over-sqs-json` | SNS envelope and nested JSON payload decode throughput. |
| `worker:single-route-full-batch` | Receive and dispatch overhead with full batches. |
| `worker:many-routes-empty-poll` | Scheduling overhead with many routes and empty receives. |
| `worker:ack-delete` | Delete-message finalization overhead with fake client. |
| `worker:failure-keep` | Failure hook plus keep finalization overhead. |
| `worker:timeout-cooperative` | Timeout handling overhead and slot retention behavior. |
| `publisher:sqs-batch` | Batch chunking and result aggregation overhead. |
| `resolver:cache-hit` | Queue/topic resolver cache-hit cost. |
| `snapshot:many-routes` | Snapshot generation cost with route/counter aggregation. |

## Suggested tooling

Use Node's built-in `node:perf_hooks` or a small benchmark dependency only if it proves useful. The benchmark suite should avoid large transitive dependencies.

Suggested commands:

```bash
npm run benchmark
npm run benchmark:ci
```

`benchmark:ci` should produce stable machine-readable output and tolerate normal CI variance. It should detect major regressions but avoid flaky microbenchmark gating.

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

Store the current baseline under a tracked path such as:

```text
docs/benchmarks/baseline.md
docs/benchmarks/baseline.json
```

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

Acceptable wording before benchmarks:

> Designed to be lightweight and SNS/SQS-specific; benchmark publication is pending.

Unacceptable wording before benchmarks:

> Blazingly fast.

> Faster than alternatives.

> Production-proven at high throughput.

The package can earn those claims only after the benchmark suite and production adoption data exist.
