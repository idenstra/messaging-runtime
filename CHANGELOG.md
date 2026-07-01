# Changelog

All notable changes to `@idenstra/messaging-runtime` must be tracked here.

Format rules:
- release sections use `## [x.y.z] - YYYY-MM-DD`
- the `package.json` version must have a matching changelog section before release
- breaking changes under `0.x` must be called out explicitly in the matching release notes

## [Unreleased]

### Added

- added queue inspection helpers and native SQS DLQ redrive task management through `SqsQueueInspector`, `SqsDlqRedriveManager`, and the combined `AwsSqsAdapter`
- added a consumer-owned queue-ops example script and explicit docs that keep manual message replay outside the shared package

### Changed

- breaking: unified the consumer-facing AWS wrappers into `AwsSqsAdapter` and `AwsSnsAdapter`, removing the earlier `AwsSqsRuntimeClient`, `AwsSqsTransportClient`, and `AwsSnsTransportClient` names before wider package adoption

## [0.1.0] - 2026-06-29

### Added

- bootstrapped the private-first `@idenstra/messaging-runtime` package, harness, and governance surface
- extracted the shared SNS/SQS worker runtime core from the former bootstrap host repo
- added route failure policy, timeout semantics, runtime metrics hooks, and manager snapshots
- added SNS/SQS translators, resolvers, and JSON publisher helpers
- added worker-service host bootstrap, manifest-driven route activation, and signal runner ergonomics
- added internal release automation, release-state validation, and exact-version consumer policy for private GitHub Packages consumption
