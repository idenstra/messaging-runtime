# Changelog

All notable changes to `@idenstra/messaging-runtime` are tracked here.

Format rules:

- release sections use `## [x.y.z] - YYYY-MM-DD`
- the `package.json` version must have a matching changelog section before release
- breaking changes must be called out explicitly in the matching release notes

## [Unreleased]

## [1.0.0] - 2026-08-06

Initial public release.

### Included

- AWS SQS worker runtime with bounded concurrency, buffering, heartbeats, handler timeouts, controlled shutdown, and explicit keep/delete behavior
- SQS JSON, string, and SNS-over-SQS route factories plus lifecycle-aware worker hosts for plain Node.js and NestJS services
- SQS and SNS publishers, resolver and discovery helpers, message-attribute builders, batch operations, queue inspection, and native DLQ redrive
- OpenTelemetry metrics and tracing helpers with W3C trace propagation
- deterministic tests, benchmark tooling, LocalStack proof, observability proof, and live AWS smoke validation
- four supported import surfaces: package root, `core`, `nest`, and `observability`

### Compatibility

- Node.js `>=24`
- conservative Semantic Versioning for the complete documented `1.x` contract
- deprecation before removal, with removals limited to a later major release
