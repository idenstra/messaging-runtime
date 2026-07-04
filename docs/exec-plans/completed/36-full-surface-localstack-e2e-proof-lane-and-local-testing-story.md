# `#36` Full-surface LocalStack E2E proof lane and local testing story

## Summary

Add the first optional LocalStack-backed end-to-end proof lane for `@idenstra/messaging-runtime`.

The lane should:
- stay local-first and opt-in
- keep `make verify-fast` and default CI deterministic and AWS-free
- exercise the built package surface against real LocalStack-backed SNS/SQS APIs
- cover runtime, publisher, routing, resolver/discovery, and queue-ops flows
- document supported vs conditional emulator behavior clearly

## Implementation changes

- Add a LocalStack harness foundation under `scripts/e2e/localstack/` with:
  - pinned compose file
  - runner script
  - suite selection support
  - fail-fast Docker checks
- Add LocalStack E2E suites under `test/e2e/localstack/` for:
  - runtime
  - publishers
  - routing and forwarding
  - discovery
  - queue operations
- Add `make verify-localstack`, `npm run e2e:localstack`, and `npm run e2e:localstack:ci`.
- Add `docs/TESTING.md` and update the README, docs index, harness docs, and operations docs with the new lane.
- Update issue `#36` so the LocalStack lane explicitly includes the newer worker ergonomics already supported by the package.

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`
- `make verify-localstack`

## Assumptions

- The LocalStack lane remains optional and local-only in this slice.
- Dynamic runtime fixture provisioning is preferred over baked container state.
- Conditional LocalStack capability gaps should be skipped explicitly and documented, not hidden.
