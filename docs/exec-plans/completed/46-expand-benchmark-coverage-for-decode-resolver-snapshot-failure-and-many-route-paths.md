# `#46` Expand benchmark coverage for decode, resolver, snapshot, failure, and many-route paths

## Summary

Expand the deterministic benchmark suite so it covers the remaining decode, resolver, snapshot, failure, and many-route scheduling hot paths without changing the runtime or package public surface.

## Implementation changes

- refactor the benchmark harness so scenario definitions and fake benchmark fixtures live outside the CLI/report orchestration path
- add new deterministic benchmark scenarios for:
  - `decode:sqs-json`
  - `decode:sns-over-sqs-json`
  - `resolver:cache-hit`
  - `resolver:cache-miss-fake-client`
  - `worker:many-routes-empty-poll`
  - `worker:failure-keep`
  - `worker:abandon-timeout`
  - `snapshot:many-routes`
- add benchmark runner self-tests that validate stable scenario ordering and machine-readable JSON report shape
- update performance docs, tracked benchmark baseline artifacts, and changelog entries to reflect the expanded suite

## Test plan

- `node --test scripts/benchmarks/*.test.mjs`
- `npm run benchmark`
- `npm run benchmark:ci`
- `npm run benchmark:compare`
- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- this slice remains benchmark- and docs-only
- fake-client-first deterministic benchmarks remain the mandatory harness posture
- tracked benchmark baselines remain historical context, while same-machine A/B comparison remains the preferred performance-proof discipline
