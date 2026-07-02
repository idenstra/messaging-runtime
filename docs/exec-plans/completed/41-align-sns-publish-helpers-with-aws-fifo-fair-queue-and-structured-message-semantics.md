# `#41` Align SNS publish helpers with AWS FIFO, fair-queue, and structured-message semantics

## Summary

Align the SNS publisher helper surface with current AWS topic semantics by validating FIFO and standard topics consistently, allowing standard-topic `MessageGroupId` fair-queue usage, and adding explicit structured topic publishing through `MessageStructure: 'json'`.

## Implementation changes

- add one shared SNS topic-semantics validator used by single and batch publish helpers
- make standard-topic behavior explicit:
  - allow non-empty `messageGroupId`
  - reject `messageDeduplicationId`
- make FIFO behavior explicit:
  - require non-empty `messageGroupId`
  - allow omitted `messageDeduplicationId`
  - validate explicit dedupe IDs when present
- add structured SNS helper types and methods:
  - `SnsStructuredJsonMessage`
  - `publishStructuredJson(...)`
  - `publishStructuredJsonBatch(...)`
- keep existing `publishJson(...)` and `publishJsonBatch(...)` as string-mode JSON convenience helpers
- reject `messageAttributes` on structured helpers
- update package docs and checked-in public-surface artifacts to reflect the corrected SNS contract

## Test plan

- transport tests cover:
  - standard-topic single publish with `messageGroupId`
  - standard-topic rejection of `messageDeduplicationId`
  - FIFO single publish requiring `messageGroupId`
  - FIFO single publish allowing omitted dedupe IDs
  - standard-topic batch publish allowing `messageGroupId`
  - FIFO batch validation remaining intact
  - structured single and batch publish setting `MessageStructure: 'json'`
  - structured publish requiring `default` and rejecting `messageAttributes`
- full proof:
  - `npm test`
  - `npm run build`
  - `npm run public-surface:check`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- structured publish remains topic-only in this slice
- structured helpers reject `messageAttributes` instead of forwarding ambiguous AWS behavior
- serializer-agnostic/raw string publishing remains deferred to `#35`
- message-attribute convenience helpers and payload-size policy remain deferred to `#47`
