# Public release readiness

This repository is not yet ready for public release until the following readiness criteria are owned and resolved. Making the repository visible before these items are resolved would weaken the maturity signal the package is meant to send.

This document assumes the readability, quick-start, adoption, and public-facing documentation cleanup is already complete. It should track only the remaining release-posture and OSS-readiness work.

Repository posture phase 1 is already complete:

- public `MIT` license added
- root `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` added
- public-first issue and PR templates added while preserving maintainer governance metadata
- consumer docs path separated from contributor / maintainer workflow docs
- package-facing docs scrubbed for the main private-only onboarding leaks

Documentation posture phase 4 is already complete:

- concise consumer-first README, quick start, cookbook, docs map, adoption guide, and security guide exist
- extension guidance is linked from the public reading path
- AWS smoke, LocalStack, and observability docs distinguish public self-test from maintainer workflow
- package-facing docs are scrubbed for the main private infrastructure and private-workflow assumptions

## Repository posture

- Change repository visibility intentionally, not as a side effect of another slice.
- Confirm GitHub security-policy settings match the tracked root `SECURITY.md`.
- Do one final repository-wide scrub for any private infrastructure, internal migration history, or confidential terms that remain after package posture is finalized.

## Package metadata

- Public/default distribution uses npmjs.
- Keep `@idenstra/messaging-runtime` as the public package identity.
- Keep GitHub Packages only as a temporary private-transition tester lane until the repo is ready for public release.
- Keep `publishConfig` pointed at npmjs/public.
- Confirm `files`, `exports`, `types`, and package tarball contents with `npm pack --dry-run`.
- Add README badges only for signals that are real and maintained.
- Re-check package description and keywords against the final public registry posture.

## API and compatibility

- The supported `1.x` import surface is already prepared and documented:
  - `@idenstra/messaging-runtime`
  - `@idenstra/messaging-runtime/core`
  - `@idenstra/messaging-runtime/nest`
  - `@idenstra/messaging-runtime/observability`
- [`COMPATIBILITY.md`](COMPATIBILITY.md) now defines:
  - current pre-`1.0` posture
  - the prepared `1.x` semver contract
  - deprecation and removal discipline
  - best-effort latest-major-only maintenance expectations
- [`MIGRATIONS.md`](MIGRATIONS.md) now reserves the breaking-release migration path for future majors.
- Keep API Extractor reports and export snapshots aligned with the final export review before public cutover.
- Re-run one final accidental-export review immediately before `1.0` is frozen.
- Keep the combined AWS adapter contract stable and documented:
  - `AwsSqsAdapter` for SQS runtime and transport operations
  - `AwsSnsAdapter` for SNS publish and topic-resolution operations
  - separate capability interfaces remain internal architecture, not setup burden
- Keep SNS publish semantics stable and documented:
  - JSON, raw string, and serializer helpers remain distinct from structured `MessageStructure: 'json'` helpers
  - standard-topic `MessageGroupId` fair-queue usage stays supported
  - FIFO deduplication behavior stays aligned with AWS content-based deduplication rules
  - service-native attribute builders and optional local size-validation semantics stay documented and stable
- Keep OTEL posture stable and documented:
  - `@opentelemetry/api` stays the only package-level observability peer dependency
  - SDK/exporter choices remain consumer-owned
  - SigNoz remains a documented backend example, not a runtime-specific adapter
- Document the supported Node baseline and why it is `>=24`.
- Define the final public cutover criteria and whether `1.0.0` is the cutover release.

## Feature maturity

- Confirm parity coverage for core worker concepts: manager, route, handler, error hook, translator, SQS runtime behavior, SNS-over-SQS decoding, and publisher helpers.
- Keep queue inspection and native DLQ redrive docs, examples, and public exports aligned.
- Keep the optional LocalStack lane current for receive, delete, visibility heartbeat, publish, routing, discovery, and queue-ops proof, and document clearly what still requires live AWS.
- Keep the optional observability lane current for OTEL metrics, worker tracing, W3C propagation, and repo-owned SigNoz backend proof.
- Keep the optional live AWS smoke lane current for real queue/topic resolution, discovery, publish, raw and envelope SNS -> SQS delivery, attribute propagation, worker receive/delete proof, and native redrive proof.
- Document idempotency, duplicate processing, DLQ, native redrive, consumer-owned manual reprocessing boundaries, and poison-message ownership.
- Document FIFO queue considerations: message group ID, deduplication ID, ordering, concurrency, and batch behavior.
- Document structured SNS topic publishing separately from JSON, raw-string, and serializer publishing, including the message-attributes limitation for `MessageStructure: 'json'`.
- Document LocalStack or emulator setup if an emulator lane is added.

## Performance maturity

- Keep the benchmark suite in [`PERFORMANCE.md`](PERFORMANCE.md) current as the runtime grows.
- Refresh and review the tracked benchmark baseline when performance-relevant behavior changes.
- Require same-machine benchmark comparison proof for performance-sensitive pull requests.
- Publish benchmark methodology before making speed claims.
- Avoid marketing terms such as "blazingly fast" until evidence exists.

## CI and release maturity

- Ensure public pull requests can run safe checks without private secrets.
- Keep release publication manual and guarded.
- Use least-privilege workflow permissions.
- Confirm release provenance requirements for npmjs.
- Keep the temporary GitHub Packages publish step automated but separate from public npm promotion.
- Confirm changelog entries are suitable for public readers.
- Confirm tags, GitHub releases, and package versions stay aligned.

## Documentation maturity

- Preserve the concise README and quick-start path already established in the repo.
- Keep the first-run example correct and copy-pasteable.
- Keep public docs in a clear reader journey through [`docs/README.md`](README.md).
- Keep `ADOPTION.md`, security guidance, and proof-lane docs accurate for outside consumers with their own infrastructure and AWS accounts.
- Separate product docs from contributor/governance docs.
- Document current limitations directly instead of hiding them in issue references.

## Release decision

The public-release decision should be made only after the remaining readiness items have explicit owners in the issue tracker and the package has a passing verification run for the exact commit that will become public.
