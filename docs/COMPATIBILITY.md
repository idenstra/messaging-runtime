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

Unsupported:
- deep imports into `dist/`
- deep imports into internal source files
- relying on undocumented package structure

## Versioning policy while `0.x`

Consumer dependency policy is intentionally strict:
- pin exact versions only
- do not use branch refs
- do not use git URL dependencies
- do not use loose semver ranges by default

Release meaning:
- patch releases are for compatible fixes, packaging corrections, and non-breaking maintenance
- minor releases are for additive public API changes and any intentional pre-1.0 breaking changes
- any breaking change under `0.x` must be called out explicitly in:
  - the matching `CHANGELOG.md` section
  - consumer upgrade guidance when needed

## Consumer upgrade guidance

Expected upgrade flow for private consumers:
1. read the changelog entry for the target version
2. update the dependency to the exact published version
3. run the consumer repo’s build, tests, and harness checks
4. remove any temporary vendored/runtime-copy seam once adoption is complete

`CDP` is the first intended consumer after this release-policy slice lands. That adoption is tracked separately and is not part of `#7`.

## GitHub Actions consumer posture

Consumer workflows that install this package from GitHub Packages should:
- use `actions/setup-node` with the GitHub Packages registry URL
- authenticate with `NODE_AUTH_TOKEN`
- ensure the consumer repo has read access to the package

This repo defines release and compatibility policy only. It does not change consumer repos in this slice.
