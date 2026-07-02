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
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation. | 50 | 0.1867 | 0.1917 | 5328.29 |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation. | 50 | 0.1137 | 0.1181 | 9139.53 |
| `worker:ack-delete` | Single-message delete finalization baseline. | 20 | 1.0582 | 1.1100 | 942.81 |
| `worker:visibility-heartbeat` | Single-message visibility heartbeat baseline. | 20 | 1.1163 | 1.1192 | 895.87 |
| `worker:single-route-full-batch` | Current single-route full-batch receive and dispatch behavior. | 20 | 16.4868 | 16.4894 | 60.70 |
| `worker:single-route-prefetch-hot-queue` | Hot-queue throughput with bounded per-route prefetch and limited concurrency. | 10 | 64.0697 | 64.9887 | 15.56 |
| `worker:single-route-prefetch-delete-batch` | Hot-queue throughput including route-local delete batch finalization. | 10 | 65.9097 | 65.9734 | 15.18 |
| `worker:stop-drain-buffered` | Stop/drain latency with a buffered message waiting behind an in-flight slot. | 10 | 1.3518 | 1.3550 | 760.21 |
| `worker:timeout-buffered-backlog` | Buffered backlog behavior while a cooperative timeout keeps the slot occupied. | 10 | 37.0420 | 37.2573 | 26.97 |

These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.

