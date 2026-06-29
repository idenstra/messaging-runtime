# Architecture

`messaging-runtime` owns the shared TypeScript SNS/SQS runtime layer used by app-owned worker services.

Owned surfaces:
- queue polling/runtime behavior
- route-level failure policy and timeout semantics
- runtime event hooks and status/snapshot surfaces
- explicit SNS/SQS transport helpers
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
- consumer adoption still follows in later slices
