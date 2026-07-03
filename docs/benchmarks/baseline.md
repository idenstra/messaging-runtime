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
| `decode:sqs-json` | Plain SQS JSON body decode throughput. | 10000 | 0.0015 | 0.0016 | 660869.48 |
| `decode:sns-over-sqs-json` | SNS envelope plus nested JSON payload decode throughput. | 10000 | 0.0022 | 0.0024 | 439868.97 |
| `publisher:sqs-batch` | SQS batch publish chunking and result aggregation. | 50 | 0.0708 | 0.0754 | 13902.06 |
| `publisher:sns-batch` | SNS batch publish chunking and result aggregation. | 50 | 0.0779 | 0.0786 | 12907.35 |
| `resolver:cache-hit` | Hot cache-hit resolution cost for mixed SQS and SNS workloads. | 5000 | 0.0008 | 0.0008 | 1307546.54 |
| `resolver:cache-miss-fake-client` | Cache-miss resolution through fake SQS GetQueueUrl and SNS ListTopics clients. | 2000 | 0.0056 | 0.0059 | 180309.02 |
| `worker:ack-delete` | Single-message delete finalization baseline. | 20 | 1.1622 | 1.2434 | 852.93 |
| `worker:visibility-heartbeat` | Single-message visibility heartbeat baseline. | 20 | 1.1562 | 1.1639 | 866.31 |
| `worker:single-route-full-batch` | Current single-route full-batch receive and dispatch behavior. | 20 | 16.6810 | 16.8722 | 59.86 |
| `worker:many-routes-empty-poll` | Route-loop scheduling overhead with many idle routes and empty receives. | 5 | 1.4921 | 1.5303 | 666.77 |
| `worker:single-route-prefetch-hot-queue` | Hot-queue throughput with bounded per-route prefetch and limited concurrency. | 10 | 63.1341 | 64.5088 | 15.82 |
| `worker:single-route-prefetch-delete-batch` | Hot-queue throughput including route-local delete batch finalization. | 10 | 64.1479 | 64.4547 | 15.62 |
| `worker:failure-keep` | Handler-failure path that resolves to keep. | 10 | 1.3905 | 1.4132 | 726.73 |
| `worker:stop-drain-buffered` | Stop/drain latency with a buffered message waiting behind an in-flight slot. | 10 | 1.1611 | 1.1638 | 862.51 |
| `worker:timeout-buffered-backlog` | Buffered backlog behavior while a cooperative timeout keeps the slot occupied. | 10 | 36.3957 | 36.6165 | 27.52 |
| `worker:abandon-timeout` | Abandon-timeout handling with late settlement and released worker slot. | 10 | 31.3072 | 31.5091 | 31.89 |
| `snapshot:many-routes` | Snapshot aggregation and cloning cost with many registered routes. | 5000 | 0.0094 | 0.0103 | 105130.90 |

These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.

