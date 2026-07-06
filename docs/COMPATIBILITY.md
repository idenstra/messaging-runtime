# Compatibility

This document defines the supported consumer contract for `@idenstra/messaging-runtime` while the package remains private-first and `0.x`.

## Runtime baseline

- supported Node baseline: `24`
- consumer repos should run their own build/test/harness after every runtime upgrade

## Supported public surface

Supported imports are limited to:
- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

Supported consumer-facing AWS wrapper classes are:
- `AwsSqsAdapter`
- `AwsSnsAdapter`

Unsupported:
- deep imports into `dist/`
- deep imports into internal source files
- relying on undocumented package structure

## Extension posture

Supported extension seams are:
- capability interfaces such as `SqsRuntimeClient`, `SqsTransportClient`, `SqsQueueOperationsClient`, and `SnsTransportClient`
- root package composition over publishers, resolvers, route factories, forwarding helpers, discovery, and queue ops
- `SqsWorkerServiceLifecycle` for framework or process integration
- `@idenstra/messaging-runtime/observability` for OTEL and vendor-specific layering

Unsupported extension style remains:
- deep imports into internal package files
- patching package internals instead of composing over supported imports
- provider-neutral broker abstractions

See [`EXTENDING.md`](EXTENDING.md) for the package-facing extension guide and compile-checked examples.

Observability subpath notes:
- `@idenstra/messaging-runtime/observability` depends on `@opentelemetry/api`
- OTEL SDK and exporter packages remain consumer-installed, not runtime-owned
- the root, `core`, and `nest` entrypoints stay usable without installing OTEL SDK/exporter packages

## Versioning policy while `0.x`

Version numbers still use the normal `major.minor.patch` SemVer shape.

Current practical posture:
- releases remain in the `0.minor.patch` range until we intentionally declare `1.0.0`
- the package therefore has a major component, but it is intentionally held at `0` for now
- consumers should read each minor bump as the main upgrade boundary while the package stays pre-`1.0`

Consumer dependency policy is intentionally strict:
- pin exact versions only
- do not use branch refs
- do not use git URL dependencies
- do not use loose semver ranges by default

Release meaning:
- patch releases are for compatible fixes, packaging corrections, and non-breaking maintenance
- minor releases are for additive public surface changes and any intentional pre-1.0 breaking changes
- any breaking change under `0.x` must be called out explicitly in:
  - the matching `CHANGELOG.md` section
  - consumer upgrade guidance when needed

## Consumer upgrade guidance

Expected upgrade flow for private consumers:
1. read the changelog entry for the target version
2. update the dependency to the exact published version
3. run the consumer repo’s build, tests, and harness checks
4. remove any temporary vendored/runtime-copy seam once adoption is complete

## GitHub Actions consumer posture

Consumer workflows that install this package from GitHub Packages should:
- use `actions/setup-node` with the GitHub Packages registry URL
- authenticate with `NODE_AUTH_TOKEN`
- ensure the consumer repo has read access to the package

This repo defines release and compatibility policy only. It does not change consumer repos in this slice.
