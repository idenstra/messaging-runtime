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
- the root package now owns:
  - SQS JSON body decoding
  - SNS-over-SQS envelope decoding
  - cached SQS queue URL resolution from name, URL, or ARN
  - cached SNS topic ARN resolution from name or ARN
  - JSON-oriented SQS/SNS publisher helpers
- resolver preload configuration is consumer-owned:
  - apps may inject known queue/topic mappings at startup
  - apps may disable runtime network lookup for strict environments
  - the library itself does not read env files, manifests, or secrets
- consumer adoption still follows in later slices

Current migration seam:
- `CDP` still owns direct communication dispatch publishing and provider-feedback envelope parsing
- `platform` still owns a separate SNS-over-SQS parser in the SES ops-event archiver
- those consumers should move to this package later, but not in `#5`
