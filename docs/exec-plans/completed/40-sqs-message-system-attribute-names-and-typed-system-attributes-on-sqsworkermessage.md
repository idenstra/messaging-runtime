# `#40` SQS `MessageSystemAttributeNames` and typed `systemAttributes` on `SqsWorkerMessage`

## Summary

Modernize worker receive calls to use `MessageSystemAttributeNames`, preserve raw AWS system attributes, and expose a typed handler-facing `message.systemAttributes` view with parsed receive-count and timestamp fields.

## Implementation changes

- replace worker receive `AttributeNames: ['All']` with `MessageSystemAttributeNames: ['All']`
- keep `MessageAttributeNames: ['All']` unchanged
- add `SqsWorkerMessageSystemAttributes`
- extend `SqsWorkerMessage` with `systemAttributes: Partial<SqsWorkerMessageSystemAttributes>`
- populate typed system attributes during worker-message normalization while preserving raw `message.attributes`
- fail normalization clearly on invalid integer or timestamp system-attribute values
- update handler-facing docs and checked-in public-surface artifacts for the new message shape

## Test plan

- runtime receive tests prove worker polling now requests:
  - `MessageSystemAttributeNames: ['All']`
  - `MessageAttributeNames: ['All']`
  - no worker `AttributeNames`
- message normalization tests prove:
  - raw `attributes` remain unchanged
  - typed `systemAttributes` values are populated and parsed correctly
  - invalid system-attribute values fail clearly
- handler-facing examples show `ApproximateReceiveCount` idempotency checks and timestamp access
- full proof:
  - `npm test`
  - `npm run build`
  - `npm run public-surface:check`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- the typed view stays nested on `message.systemAttributes`
- typed system-attribute field names preserve AWS naming
- timestamp-like system attributes use `Date`
- raw `message.attributes` and `message.raw` remain available for compatibility
