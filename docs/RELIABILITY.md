# Reliability

This library repo should stay deterministic and cheap to verify.

Current reliability posture:
- validator self-tests run in CI
- package build/test run in CI
- optional LocalStack-backed end-to-end proof is available through `make verify-localstack`
- optional live AWS smoke is available through `make verify-aws-smoke`
- no live AWS requirement in the default repo gate
- no Docker dependency in `make verify-fast`

Runtime reliability work should continue to favor:
- bounded failure modes
- explicit ack behavior
- deterministic shutdown behavior
- local or emulator-first tests

When behavior changes touch worker runtime, publishers, routing, or queue-ops, maintainers should prefer:

1. deterministic unit/contract proof through `make verify-fast`;
2. optional emulator proof through `make verify-localstack`;
3. optional backend-local observability proof through `make verify-observability` when OTEL or tracing behavior changed;
4. live AWS smoke through `make verify-aws-smoke` when emulator proof still cannot answer the question, when discovery or redrive behavior changed, or before a real package publish.
