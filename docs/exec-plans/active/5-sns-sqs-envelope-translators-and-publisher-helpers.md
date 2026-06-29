# `#5` SNS/SQS envelope translators and publisher helpers

## Summary

Add the first shared SNS/SQS transport-helper surface to `@idenstra/messaging-runtime`:
- SQS JSON body decoding
- SNS-over-SQS envelope decoding
- cached queue/topic resolution
- JSON-oriented SQS/SNS publisher helpers

This slice is library-only. It does not migrate `CDP` or `platform` consumers yet.

Related:
- `idenstra/platform#18`
- `idenstra/CDP#180`
- `idenstra/CDP#187`

## Implementation changes

- add root-exported transport decoders:
  - `decodeSqsJsonBody`
  - `decodeSnsEnvelope`
  - `decodeSnsNotificationJson`
- add cached resolvers:
  - `SqsQueueUrlResolver`
  - `SnsTopicArnResolver`
- standardize address flexibility:
  - SQS accepts queue name, queue URL, or queue ARN
  - SNS accepts topic name or topic ARN
- allow consumers to inject preloaded queue/topic mappings and optionally disable runtime network lookup
- add JSON publisher helpers and AWS SDK adapters:
  - `SqsPublisher`
  - `SnsPublisher`
  - `AwsSqsTransportClient`
  - `AwsSnsTransportClient`
- keep the package SNS/SQS-specific and avoid generic broker abstractions
- update docs so the root package surface and migration seam are explicit

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `make verify-fast`
- `make verify`

## Assumptions

- topic resolution is read-only and never creates SNS topics
- cache is process-local in-memory only, layered on top of consumer-injected config where provided
- consumer adoption remains a later slice
