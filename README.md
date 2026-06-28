# messaging-runtime

`messaging-runtime` is Idenstra's dedicated private-first home for the shared TypeScript SNS/SQS messaging runtime.

Current state:
- single package surface: `@idenstra/messaging-runtime`
- extracted worker runtime core now lives here
- no business handlers live here
- consumer adoption is still deferred until later slices

## Purpose

This repo will own:
- the shared SNS/SQS polling/runtime core
- SNS/SQS-specific publisher and envelope helpers
- worker host/bootstrap ergonomics for app-owned worker services
- package-level tests and verification for the shared runtime

This repo will not own:
- `CDP` communication handlers
- app-specific persistence or SES business logic
- generic broker abstractions across unrelated transports

## Quick start

```bash
npm ci
npm test
npm run build
make audit
make verify-fast
make verify
```

## Canonical docs

- [AGENTS.md](AGENTS.md)
- [WORKFLOW.md](WORKFLOW.md)
- [docs/HARNESS.md](docs/HARNESS.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EXECUTION_PLANS.md](docs/EXECUTION_PLANS.md)
- [docs/ISSUE_TRACKING.md](docs/ISSUE_TRACKING.md)

## Packaging posture

- package name: `@idenstra/messaging-runtime`
- registry posture: GitHub Packages, private-first
- package publication is intentionally blocked in the current extraction phase
- version posture: `0.x`
- OSS readiness is explicitly deferred
- release/publication policy is formalized later under `#7`
