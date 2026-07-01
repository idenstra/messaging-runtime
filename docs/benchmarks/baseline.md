# Benchmark baseline

Package: `@idenstra/messaging-runtime@0.1.0`
Node: `v24.18.0`
Platform: `linux/x64`
CPU: `AMD Ryzen 7 3700X 8-Core Processor`
Command: `npm run benchmark`
Warmup samples: `1`
Measured samples: `3`

| Scenario | Description | Iterations/sample | Median ms/iteration | P95 ms/iteration | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation. | 50 | 0.1902 | 0.2087 | 5099.68 |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation. | 50 | 0.1110 | 0.1190 | 9388.44 |
| `worker:ack-delete` | Single-message delete finalization baseline. | 20 | 1.1180 | 1.1319 | 896.36 |
| `worker:visibility-heartbeat` | Single-message visibility heartbeat baseline. | 20 | 1.1372 | 1.1417 | 878.80 |
| `worker:single-route-full-batch` | Current full-batch receive and dispatch baseline. | 20 | 51.2951 | 51.3166 | 19.50 |

These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.

