# Benchmark baseline

Package: `@idenstra/messaging-runtime@0.1.0`
Node: `v24.18.0`
Platform: `linux/x64`
CPU: `AMD Ryzen 7 3700X 8-Core Processor`
Command: `npm run benchmark:baseline`
Warmup samples: `1`
Measured samples: `3`

| Scenario | Description | Iterations/sample | Median ms/iteration | P95 ms/iteration | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation. | 50 | 0.1950 | 0.1957 | 5184.10 |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation. | 50 | 0.1483 | 0.1589 | 6832.29 |
| `worker:ack-delete` | Single-message delete finalization baseline. | 20 | 1.1219 | 1.1364 | 893.25 |
| `worker:visibility-heartbeat` | Single-message visibility heartbeat baseline. | 20 | 1.1622 | 1.1842 | 867.13 |
| `worker:single-route-full-batch` | Current full-batch receive and dispatch baseline. | 20 | 51.5122 | 51.5985 | 19.41 |

These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.

