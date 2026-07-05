# `#57` Self-contained OTEL/SigNoz observability E2E proof lane

## Summary

Add a self-contained observability proof layer above the LocalStack transport/runtime lane.

The lane should:
- keep `messaging-runtime` independent from internal repositories
- stay optional and outside the default deterministic harness
- own a repo-local SigNoz + OTEL collector stack through Compose and wrapper commands
- reuse the LocalStack fixture foundation from `#36`
- prove metrics and traces through real worker flows and direct backend queries

## Implementation changes

- Add a pinned repo-owned observability stack under `scripts/e2e/observability/` with:
  - Compose topology
  - collector and backend config
  - runner script
  - backend warmup flow
- Add observability E2E suites under `test/e2e/observability/` for:
  - direct SQS success metrics and spans
  - snapshot-derived gauges
  - raw SNS -> SQS trace propagation
  - handler failure telemetry
  - timeout and heartbeat telemetry
  - delete-batch failure telemetry
- Add `make verify-observability`, `npm run e2e:observability`, and `npm run e2e:observability:ci`.
- Extend the LocalStack E2E support helpers with queue-depth waiting needed by the observability-backed SNS proof.
- Update the README, observability docs, testing docs, harness docs, public-release guidance, and the OTEL example so the public observability story is self-contained and current.

## Test plan

- `npm run lint`
- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`
- `make verify-observability`

## Assumptions

- The repo owns its own local backend recipe and does not depend on `platform`.
- Logs remain out of scope; this lane proves metrics and traces only.
- ClickHouse queries are the scriptable source of truth for backend assertions.
- The lane tears its own state down for deterministic reruns.
