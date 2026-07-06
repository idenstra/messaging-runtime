# Contributing

Thanks for contributing to `messaging-runtime`.

This repository is a shared SNS/SQS runtime library, not an application repo. Changes should keep the package transport-specific, consumer-agnostic, and easy to verify locally.

## Start here

Use this reading order before opening a non-trivial change:

1. [`README.md`](README.md) for the product overview and public docs path
2. [`AGENTS.md`](AGENTS.md) for repo rules and AI-agent guidance
3. [`WORKFLOW.md`](WORKFLOW.md) for proof tiers and handoff expectations
4. [`docs/HARNESS.md`](docs/HARNESS.md) for the repo verification entrypoints
5. the relevant product docs for the area you are changing

For larger changes, also read:

- [`docs/ISSUE_TRACKING.md`](docs/ISSUE_TRACKING.md)
- [`docs/EXECUTION_PLANS.md`](docs/EXECUTION_PLANS.md)
- [`docs/QUALITY_BAR.md`](docs/QUALITY_BAR.md)
- [`docs/AI_ENGINEERING.md`](docs/AI_ENGINEERING.md)

## What belongs here

Good contributions usually fit one or more of these shapes:

- runtime behavior and worker-host improvements for SNS/SQS-only flows
- publisher, resolver, discovery, queue-ops, or observability improvements that stay inside the supported package scope
- documentation, examples, proof-lane, or harness improvements that make the package easier to adopt safely

Out of scope:

- transport-neutral broker abstractions
- Kafka, RabbitMQ, Redis, or unrelated transport families
- application-specific business handlers or domain types
- queue/topic provisioning APIs
- consumer-owned manual reprocessing helpers

## Supported public surface

Keep changes on the supported imports only:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

Do not introduce new deep-import guidance, and do not rely on internal package structure from `src/` or `dist/`.

## Workflow

Small documentation or template fixes may be straightforward pull requests. Non-trivial changes should follow the same-repo `issue -> plan -> PR` flow described in:

- [`docs/ISSUE_TRACKING.md`](docs/ISSUE_TRACKING.md)
- [`docs/EXECUTION_PLANS.md`](docs/EXECUTION_PLANS.md)

If you are using AI assistance, treat [`AGENTS.md`](AGENTS.md) as the repo’s primary machine-readable contributor contract.

## Proof expectations

Minimum proof depends on the change type:

- docs-only or template-only changes:
  - `make audit`
- package, harness, or validator changes:
  - `HARNESS_STRICT=1 make verify-fast`
- optional proof lanes when the changed area requires them:
  - `make verify-localstack`
  - `make verify-observability`
  - `make verify-aws-smoke`

Use [`WORKFLOW.md`](WORKFLOW.md) and [`docs/HARNESS.md`](docs/HARNESS.md) for the exact proof tiers.

## Pull requests

Write PRs for outside reviewers:

- summarize the intent first
- call out public-surface impact clearly
- list the proof you ran
- keep docs updated in the same change set when behavior or contributor workflow changes

The PR template also includes maintainer workflow metadata used by this repository’s governance checks. Outside contributors can leave those fields at the documented defaults when they do not apply.

## Security reports

Do not open public issues for vulnerabilities.

Use the root [`SECURITY.md`](SECURITY.md) policy and GitHub private vulnerability reporting instead.
