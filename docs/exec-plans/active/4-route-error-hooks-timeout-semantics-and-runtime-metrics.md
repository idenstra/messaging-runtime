# `#4` Route error hooks, timeout semantics, and runtime metrics

## Summary

Extend the extracted SNS/SQS worker core with the first real consumer-control surface:
- route-level failure policy
- route-level error hooks
- handler timeout semantics
- synchronous runtime metrics hooks
- richer route and manager snapshots

This slice keeps the package SNS/SQS-specific and does not add worker hosts, publisher helpers, or consumer adoption.

Related:
- `idenstra/platform#18`
- `idenstra/CDP#180`

## Implementation changes

- extend the core route contract with:
  - `failureAction`
  - `handlerTimeoutMs`
  - `timeoutStrategy`
  - `onError`
  - `abortSignal` in handler context
- add manager-level runtime event hooks and aggregate `getSnapshot()` support
- keep success ack explicit:
  - success defaults to `delete`
  - handlers may still return `keep`
- implement timeout behavior with:
  - `cooperative` default
  - `abandon` opt-in
- keep timeout safety strict:
  - `abandon` timeouts always keep
  - `cooperative` timeouts may resolve to delete or keep after settlement
- validate the new route configuration at registration time
- update repo docs so the runtime ownership surface reflects the new controls

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `make verify-fast`
- `make verify`

## Assumptions

- metrics and snapshots stay process-local and reset on restart
- async observability/export remains a later issue
- host/runtime activation, manifests, and publisher helpers remain later issues
