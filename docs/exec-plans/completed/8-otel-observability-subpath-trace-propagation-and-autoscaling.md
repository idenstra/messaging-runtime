# Execution Plan

## Summary

Implement `messaging-runtime#8` as an OTEL-first observability slice:
- add `@idenstra/messaging-runtime/observability`
- add OTEL metrics mapping from runtime events and snapshots
- add W3C trace propagation helpers for SNS/SQS message attributes
- add worker tracing wrappers for consumer spans
- document SigNoz as the first OTLP backend example
- document AWS-aware autoscaling guidance for ECS/Fargate and Kubernetes workers

## Implementation changes

- add the `observability` public subpath and package exports
- add `createOpenTelemetrySqsWorkerMetricsAdapter(...)`
- add W3C trace-context injection and extraction helpers for SQS and SNS message attributes
- add `withOpenTelemetrySqsWorkerTracing(...)` with route-shape preservation for worker-host ergonomics
- add a compile-checked observability example worker that targets OTLP/SigNoz
- update public-surface reports, snapshots, validators, and harness audit expectations for the new subpath
- update consumer docs with OTEL, SigNoz, and autoscaling guidance
- refine issue `#8` so it explicitly owns OTEL helpers, SigNoz backend guidance, and AWS-aware autoscaling docs

## Test plan

- add observability unit coverage for metrics mapping, snapshot gauges, and tracing helpers
- compile-check the observability example against the supported public imports
- run:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- OTEL helpers stay vendor-neutral and use injected API objects
- SigNoz remains documentation and example guidance, not package-specific code
- raw SNS -> SQS delivery is the supported propagation mode for SNS fanout into worker queues
- logs, Lambda guidance, and non-raw SNS -> SQS propagation remain out of scope
