# `messaging-runtime#35` Execution Plan: String and Serializer Publishers, Attribute Builders, and Size Guards

## Summary

Implement the combined `#35 + #47` publisher-surface slice by:

- keeping the current JSON and structured SNS helpers intact
- adding explicit string-body helpers for SQS and SNS
- adding serializer-based helpers for custom string serialization
- adding service-specific SNS/SQS message-attribute builders
- adding optional local request-size validation with publisher defaults and per-call override

Locked execution shape:

- `#35` owns the execution plan and PR
- `#47` is closed by the same draft PR
- the branch/PR flow stops at a stabilized draft PR after local proof and CI remediation

## Implementation Changes

- extend `SqsPublisher` and `SnsPublisher` with string and serializer helper families for single and batch publishing
- keep batch chunking, queue/topic resolution, and keyed aggregate success/failure results aligned with the existing JSON helpers
- add root-exported SQS attribute builders for `String`, `Number`, and `Binary`
- add root-exported SNS attribute builders for `String`, `Number`, `Binary`, and `String.Array`
- add optional `sizeValidation` defaults on publisher constructors plus per-call override/disable on send/publish inputs
- validate message body, supported attribute bytes, and SNS subject bytes conservatively before AWS calls when size validation is enabled
- update README/getting-started/features/public-release docs, changelog, and public-surface artifacts so the new publisher contract is explicit

## Test Plan

- cover `sendString(...)`, `sendStringBatch(...)`, `sendSerialized(...)`, and `sendSerializedBatch(...)`
- cover `publishString(...)`, `publishStringBatch(...)`, `publishSerialized(...)`, and `publishSerializedBatch(...)`
- keep regression coverage for the existing JSON and structured SNS helpers
- prove keyed partial-success / partial-failure normalization on the new batch helpers
- prove SNS topic semantics from `#41` still apply to the new string and serializer helpers
- prove attribute builder helpers generate service-native AWS shapes while raw message-attribute maps remain supported
- prove publisher-level defaults, per-call override, per-call disable, and batch entry boundary errors for size validation

## Assumptions

- string and serializer publishing land together to avoid repeated public-surface churn
- structured SNS publishing remains separate and continues rejecting `messageAttributes`
- “full AWS matrix” for attribute helpers means the currently supported service-native logical types, not reserved or unimplemented SDK fields
- the repository still requires `make plan-close ISSUE=35` before the governed draft PR is opened
