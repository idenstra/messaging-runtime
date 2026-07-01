# Architecture

`messaging-runtime` owns the shared TypeScript SNS/SQS runtime layer used by app-owned worker services.

Owned surfaces:
- queue polling/runtime behavior
- route-level failure policy and timeout semantics
- runtime event hooks and status/snapshot surfaces
- worker-service host/bootstrap and signal-runner ergonomics
- explicit SNS/SQS transport helpers
- queue inspection and native DLQ redrive task helpers
- worker host/bootstrap ergonomics
- package-level verification and documentation

Not owned here:
- domain handlers
- app persistence
- SES/communication business policies
- broker abstractions for Kafka, RabbitMQ, or other unrelated transports

Current state:
- single package
- private-first
- extracted SQS worker runtime core now lives here
- the runtime core now owns route error hooks, timeout strategies, and metrics/snapshot hooks
- the root package now owns worker-service lifecycle/bootstrap helpers:
  - manifest-driven route activation
  - queue binding resolution through injected resolver state
  - signal-driven runner ergonomics for consumer-owned entrypoints
- the optional Nest adapter remains a consumer-facing convenience layer only:
  - module lifecycle integration
  - logger bridging
  - no runtime-semantic or performance divergence from framework-agnostic usage
  - adapter implementation stays separated from core runtime files
- the root package now owns:
  - SQS JSON body decoding
  - SNS-over-SQS envelope decoding
  - cached SQS queue URL resolution from name, URL, or ARN
  - cached SNS topic ARN resolution from name or ARN
  - JSON-oriented SQS/SNS publisher helpers
  - queue inspection and normalized queue attribute snapshots
  - native SQS DLQ redrive task management
  - combined AWS adapter setup for consumer-facing SQS and SNS wiring
- resolver preload configuration is consumer-owned:
  - apps may inject known queue/topic mappings at startup
  - apps may disable runtime network lookup for strict environments
  - the library itself does not read env files, manifests, or secrets
- worker boot remains consumer-owned:
  - apps declare handlers in code
  - apps load manifests/config from env/files/secrets
  - apps provide the final worker process entrypoint
- consumer adoption still follows in later slices

Public package contract:
- package-facing docs describe only the supported SNS/SQS runtime surface
- cross-repo migration status belongs in issues, not in library docs
- consumer examples should stay neutral and reusable

## Internal structure

```mermaid
flowchart TD
  Root["root package exports"]
  Core["core runtime"]
  Host["host/bootstrap"]
  Transport["transport helpers"]
  Adapter["optional adapters"]

  Root --> Core
  Root --> Host
  Root --> Transport
  Root --> Adapter
```

## Consumer integration shape

```mermaid
flowchart LR
  App["consumer app"]
  Config["consumer-loaded config"]
  Runtime["messaging-runtime"]
  AWS["AWS SNS/SQS"]

  App --> Config
  App --> Runtime
  Config --> Runtime
  Runtime --> AWS
```

This separation is deliberate:
- consumer apps remain responsible for business handlers and configuration sourcing
- consumer apps remain responsible for manual replay, idempotency storage, and domain-safe recovery rules
- the package remains responsible for reusable SNS/SQS runtime mechanics
