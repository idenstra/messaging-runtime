# Execution Plan

## Summary

Add thin, root-exported forwarding handler helpers for fixed queue-to-queue and queue-to-topic relay flows, reusing the existing publisher surfaces instead of introducing route sugar or workflow behavior.

## Implementation changes

- add root-exported forwarding helpers for SQS-target JSON, string, and serialized relay flows
- add root-exported forwarding helpers for SNS-target JSON, string, serialized, and structured JSON relay flows
- add explicit inbound message-attribute carry-over conversion with clear failure behavior for unsupported shapes
- keep destinations fixed per helper instance while allowing optional payload/body mapping and publisher-native option builders
- add tests, a compile-checked example, and package-facing docs that position the helpers as thin composition over routes and publishers

## Test plan

- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- this slice stays handler-only and does not add route sugar or dynamic destination routing
- publish failures keep using the normal worker failure path through thrown errors
- structured SNS forwarding remains attribute-free because the structured publisher surface already rejects `messageAttributes`
