# Compatibility

This document defines the consumer contract for `@idenstra/messaging-runtime`.

Use it together with:

- [`EXTENDING.md`](EXTENDING.md) for supported extension seams
- [`MIGRATIONS.md`](MIGRATIONS.md) for future breaking-release upgrade notes
- [`PUBLIC_RELEASE.md`](PUBLIC_RELEASE.md) for the remaining repository-publication work

## Current posture

The package is still pre-`1.0`, but the intended `1.x` compatibility contract is already prepared here.

Current practical posture:

- the package remains in the `0.minor.patch` range until public cutover is deliberate
- consumers should pin exact versions while the package stays pre-`1.0`
- each minor bump is still the main upgrade boundary before `1.0.0`
- any pre-`1.0` breaking change must be called out explicitly in `CHANGELOG.md`

Consumer dependency policy while `0.x`:

- pin exact versions
- do not use branch refs
- do not use git URL dependencies
- do not use loose semver ranges by default

## Runtime baseline

- supported Node baseline: `>=24`
- consumers should run their own build, tests, and proof lanes after every upgrade

The Node baseline is part of the public contract once `1.x` starts. A Node baseline increase is therefore a major-version change.

## Supported public import surface

Supported imports for the future `1.x` contract are exactly:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

These four specifiers are the only supported package entrypoints.

Notes:

- `./core`, `./nest`, and `./observability` are first-class supported subpaths, not experimental or best-effort surfaces
- supported consumer-facing AWS adapter classes remain `AwsSqsAdapter` and `AwsSnsAdapter`
- optional peers remain consumer-owned:
  - `@nestjs/common` for `@idenstra/messaging-runtime/nest`
  - `@opentelemetry/api` plus consumer-selected SDK/exporter packages for `@idenstra/messaging-runtime/observability`

Unsupported:

- deep imports into `dist/`
- deep imports into internal source files
- reliance on undocumented package structure

## Contract and non-contract surfaces

The public contract for `1.x` is:

- the four supported import specifiers above
- exported runtime, transport, queue-ops, Nest, and observability symbols from those entrypoints
- documented worker runtime semantics
- documented queue-ops behavior
- documented compatibility, deprecation, and migration policy
- the supported Node baseline

Not part of the public contract:

- internal folder layout
- `dist/` file paths
- test layout and proof-lane scaffolding
- harness scripts and repository workflow files
- benchmark fixtures or runner internals

Public API review before `1.0` should still prune any accidental exports that do not look intentionally consumer-facing. Once that final review is complete, the checked-in API reports and export snapshots become the mechanical freeze source for `1.x`.

## Extension posture

Supported extension seams are:

- capability interfaces such as `SqsRuntimeClient`, `SqsTransportClient`, `SqsQueueOperationsClient`, and `SnsTransportClient`
- root package composition over publishers, queue resolvers, topic resolvers, route factories, forwarding handlers, discovery helpers, and queue ops
- `SqsWorkerServiceLifecycle` for framework or process integration
- `@idenstra/messaging-runtime/observability` for OTEL and vendor-specific layering

Unsupported extension style remains:

- deep imports into internal package files
- patching package internals instead of composing over supported imports
- transport-neutral abstractions

See [`EXTENDING.md`](EXTENDING.md) for the package-facing extension guide and compile-checked examples.

## `1.x` semver policy

`1.x` will use the conservative full-contract SemVer model.

Major releases:

- supported import-surface changes
- exported type or signature changes that require consumer code changes
- documented worker runtime or queue-ops semantics changes that require consumer changes
- Node baseline changes

Minor releases:

- additive public APIs
- additive documented behavior that does not require consumer changes
- new supported helper surfaces that are optional for existing consumers

Patch releases:

- compatible fixes
- docs corrections
- packaging fixes
- non-breaking maintenance

## Deprecation and removal policy

Deprecation policy for `1.x`:

- mark deprecations in the type/docs surface and `CHANGELOG.md` first
- do not emit runtime deprecation warnings by default
- remove deprecated surface only in the next major
- any removal must have appeared as deprecated in at least one earlier released version

This keeps the package quiet in production while still making deprecation visible in code review, docs, and release notes.

## Maintenance and support policy

Public maintenance posture for `1.x`:

- best effort only
- latest major only
- no SLA
- no backport promise for older majors or older release lines
- docs and examples track the current supported major only

## Breaking-change migration guidance

Future breaking releases must ship migration guidance in [`MIGRATIONS.md`](MIGRATIONS.md).

Rules:

- routine release notes stay in `CHANGELOG.md`
- every future breaking release needs a dedicated migration section in `docs/MIGRATIONS.md`
- migration notes must explain consumer impact, required code/config changes, and rollout expectations

## Consumer upgrade flow

Expected upgrade flow:

1. read the target version in `CHANGELOG.md`
2. read [`MIGRATIONS.md`](MIGRATIONS.md) when the upgrade crosses a breaking release
3. update the dependency to the exact published version
4. run the consumer repository build, tests, and proof lanes
5. verify any service-owned rollout, idempotency, and queue-policy assumptions still hold

This repository defines the package contract. Consumer services still own deployment, rollout pacing, idempotency storage, and domain-safe recovery policy.
