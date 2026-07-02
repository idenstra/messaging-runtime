# `#32` Same-machine benchmark comparison workflow and performance proof discipline

## Summary

Add an explicit same-machine benchmark comparison workflow so throughput-sensitive changes are evaluated against before/after results from the same host, while keeping the checked-in baseline as historical context rather than the acceptance source of truth.

## Implementation changes

- add a benchmark comparison helper that reads two benchmark JSON reports and summarizes scenario deltas
- validate environment fingerprint alignment for same-machine comparisons:
  - Node version
  - platform
  - architecture
  - CPU model
  - benchmark sampling parameters
- support an explicit override for historical or cross-machine comparisons, but make same-environment comparison the default discipline
- add package scripts so maintainers can:
  - emit machine-readable benchmark reports
  - compare base and candidate reports locally
- add tests for comparison parsing, fingerprint validation, scenario diffing, and output behavior
- update `docs/PERFORMANCE.md` to state clearly:
  - checked-in baseline artifacts are historical tracked snapshots
  - PR acceptance for perf-sensitive changes requires same-machine A/B comparison
  - CI remains benchmark-smoke only
- update PR-facing guidance and script docs so performance-sensitive changes call out same-machine benchmark proof explicitly

## Test plan

- unit tests for the benchmark comparison script:
  - report loading and validation
  - fingerprint mismatch detection
  - overlapping scenario comparison
  - added/removed scenario reporting
  - optional environment-mismatch override behavior
- full proof:
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- checked-in `docs/benchmarks/baseline.*` remain useful as historical context and documentation
- CI should not gate on benchmark numeric thresholds in this slice
- benchmark acceptance for throughput changes should compare base and candidate reports from the same machine whenever possible
