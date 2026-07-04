# Execution Plan

## Summary

Add explicit JSON and string route factories for the common SQS and SNS-over-SQS worker shapes, while keeping manual route objects as the escape hatch for custom decoders.

## Implementation changes

- add root-exported `sqsJsonRoute(...)`, `snsJsonQueueRoute(...)`, and `sqsStringRoute(...)` plain object factories
- support direct-manager `queueUrl` binding plus service-host `queue` or manifest-owned binding
- keep `onError`, `lifecycle`, `config`, and `receive` passthrough unchanged
- add tests for decode defaults, host/direct fit, binding validation, and SNS payload-shape modes
- update package-facing docs, examples, and public-surface artifacts

## Test plan

- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- this slice stays factory-only and does not absorb forwarding helpers
- the root export remains the only public surface for the new helpers
- manual route objects remain the supported path for custom decode behavior
