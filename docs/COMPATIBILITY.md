# Compatibility

This document defines the stable consumer contract for `@idenstra/messaging-runtime` `1.x`.

Use it together with:

- [`EXTENDING.md`](EXTENDING.md) for supported extension seams
- [`MIGRATIONS.md`](MIGRATIONS.md) for future breaking-release upgrade notes

## Runtime baseline

- supported Node.js baseline: `>=24`
- consumers should run their own build, tests, and proof lanes after every upgrade

The Node.js baseline is part of the public contract. Raising it requires a major release.

## Supported public imports

The supported package entrypoints are exactly:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

The `core`, `nest`, and `observability` subpaths are first-class supported surfaces.

Supported consumer-facing AWS adapters are `AwsSqsAdapter` and `AwsSnsAdapter`.

Optional peers remain consumer-owned:

- `@nestjs/common` for `@idenstra/messaging-runtime/nest`
- `@opentelemetry/api` plus consumer-selected SDK and exporter packages for `@idenstra/messaging-runtime/observability`

Deep imports into `dist/`, internal source files, or undocumented package structure are unsupported.

## Contract boundaries

The public contract includes:

- exports from the four supported entrypoints
- documented worker-runtime semantics
- documented queue-ops behavior
- documented compatibility, deprecation, and migration policy
- the supported Node.js baseline

The public contract does not include:

- internal folder layout or `dist/` paths
- test layout and proof-lane scaffolding
- harness scripts and repository workflows
- benchmark fixtures or runner internals

Checked-in API reports and export snapshots are the mechanical freeze source for the supported entrypoints.

## Extension posture

Supported extension seams include:

- capability interfaces such as `SqsRuntimeClient`, `SqsTransportClient`, `SqsQueueOperationsClient`, and `SnsTransportClient`
- composition over publishers, queue resolvers, topic resolvers, route factories, forwarding handlers, discovery helpers, and queue ops
- `SqsWorkerServiceLifecycle` for framework or process integration
- the `observability` entrypoint for OpenTelemetry and vendor-specific layering

Deep imports, patches to package internals, and transport-neutral abstractions are unsupported extension styles. See [`EXTENDING.md`](EXTENDING.md) for examples.

## Semantic Versioning

Major releases include:

- supported import-surface changes
- exported type or signature changes that require consumer edits
- documented worker-runtime or queue-ops semantic changes that require consumer changes
- Node.js baseline changes

Minor releases include additive public APIs or documented behavior that does not require consumer changes.

Patch releases include compatible fixes, documentation corrections, packaging fixes, and non-breaking maintenance.

## Deprecation and removal

- deprecations are marked in types, documentation, and `CHANGELOG.md`
- runtime deprecation warnings are not emitted by default
- deprecated APIs are removed only in a later major release
- removal requires deprecation in at least one earlier released version

## Maintenance and support

- support is best effort, with no SLA
- only the latest major is maintained
- there is no backport commitment for earlier majors or release lines
- documentation and examples track the current supported major

## Breaking changes

Every breaking release must include a dedicated section in [`MIGRATIONS.md`](MIGRATIONS.md) describing affected consumers, required code or configuration changes, rollout guidance, and verification.

Routine release notes remain in [`../CHANGELOG.md`](../CHANGELOG.md).
