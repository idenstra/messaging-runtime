# Benchmark baseline

Package: `@idenstra/messaging-runtime@1.0.0`
Node: `v24.18.0`
Platform: `linux/x64`
CPU: `AMD Ryzen 7 3700X 8-Core Processor`
Command: `npm run benchmark:baseline`
Warmup samples: `1`
Measured samples: `3`

| Scenario | Description | Iterations/sample | Median ms/iteration | P95 ms/iteration | Ops/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| `decode:sqs-json` | Plain SQS JSON body decode throughput. | 10000 | 0.0015 | 0.0016 | 652524.40 |
| `decode:sns-over-sqs-json` | SNS envelope plus nested JSON payload decode throughput. | 10000 | 0.0023 | 0.0026 | 420526.14 |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation. | 50 | 0.0829 | 0.0842 | 12344.04 |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation. | 50 | 0.1256 | 0.1480 | 7515.79 |
| `resolver:cache-hit` | Hot cache-hit resolution cost for mixed SQS and SNS workloads. | 5000 | 0.0010 | 0.0010 | 987294.96 |
| `resolver:cache-miss-fake-client` | Cache-miss resolution through fake SQS GetQueueUrl and SNS ListTopics clients. | 2000 | 0.0058 | 0.0063 | 172806.07 |
| `worker:ack-delete` | Single-message delete finalization baseline. | 20 | 1.2505 | 1.2649 | 809.27 |
| `worker:visibility-heartbeat` | Single-message visibility heartbeat baseline. | 20 | 1.2025 | 1.2103 | 830.55 |
| `worker:single-route-full-batch` | Current single-route full-batch receive and dispatch behavior. | 20 | 16.8378 | 17.1812 | 59.77 |
| `worker:many-routes-empty-poll` | Route-loop scheduling overhead with many idle routes and empty receives. | 5 | 1.5237 | 1.6591 | 653.20 |
| `worker:single-route-prefetch-hot-queue` | Hot-queue throughput with bounded per-route prefetch and limited concurrency. | 10 | 63.9536 | 64.3141 | 15.63 |
| `worker:single-route-prefetch-delete-batch` | Hot-queue throughput including route-local delete batch finalization. | 10 | 63.7949 | 63.8423 | 15.67 |
| `worker:failure-keep` | Handler-failure path that resolves to keep. | 10 | 1.4389 | 1.5609 | 681.41 |
| `worker:stop-drain-buffered` | Stop/drain latency with a buffered message waiting behind an in-flight slot. | 10 | 0.1740 | 0.1869 | 5671.69 |
| `worker:timeout-buffered-backlog` | Buffered backlog behavior while a cooperative timeout keeps the slot occupied. | 10 | 36.7789 | 36.9255 | 27.20 |
| `worker:abandon-timeout` | Abandon-timeout handling with late settlement and released worker slot. | 10 | 31.0422 | 31.0792 | 32.25 |
| `snapshot:many-routes` | Snapshot aggregation and cloning cost with many registered routes. | 5000 | 0.0095 | 0.0102 | 106063.87 |

These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.

