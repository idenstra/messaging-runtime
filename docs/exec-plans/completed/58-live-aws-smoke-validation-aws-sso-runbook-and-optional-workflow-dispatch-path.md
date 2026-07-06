# Execution Plan

## Summary

Implement `#58` as the real-AWS feature-integrity lane for `messaging-runtime`.

The lane stays:

- optional for normal development and PR work;
- AWS-real and SSO-friendly for local maintainers;
- independent from internal repositories;
- broad enough to prove the package-owned SNS/SQS feature families, including native DLQ redrive;
- mandatory only on the real release publish path.

## Implementation changes

- keep `make verify-aws-smoke`, `npm run e2e:aws-smoke`, and `npm run e2e:aws-smoke:ci`
- add suite selection for:
  - `transport`
  - `worker`
  - `routing`
  - `discovery`
  - `queue-ops`
  - `redrive`
- extend the live AWS harness to provision:
  - standard and FIFO queues
  - standard and FIFO topics
  - raw and envelope SNS -> SQS subscriptions
  - a dedicated source-queue + DLQ fixture for native redrive proof
- cover real AWS resolution, discovery, inspection, publishers, routing, worker execution, FIFO receive-attempt request shape, forwarding helpers, and native DLQ redrive start/list/cancel behavior
- keep the smoke running against built `dist/` output only
- add the manual reusable `.github/workflows/aws-smoke.yml` workflow using GitHub OIDC
- gate the release workflow publish path on the reusable AWS smoke workflow while keeping `publish=false` dry-run validation AWS-free
- document the AWS SSO runbook, suite names, fixture safety rules, workflow usage, and release-time gate
- keep any narrow real-AWS compatibility fixes in scope when the smoke exposes them

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`
- `make verify-aws-smoke`

## Assumptions

- live AWS stays out of default CI and `make verify-fast`
- the manual workflow and release workflow both reuse the same repo-owned AWS smoke runner
- provisioning remains test-harness-only and does not expand the public package API
