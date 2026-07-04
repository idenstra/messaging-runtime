# Execution Plan

## Summary

Add shared, code-owned route lifecycle hooks to `@idenstra/messaging-runtime` so both direct `SqsWorkerManager` users and `SqsWorkerServiceHost` users can manage route-local startup and cleanup without adding a second lifecycle model.

## Implementation changes

- add `SqsWorkerLifecycleHook` and nested `SqsWorkerRouteLifecycleHooks` to the core route contract under `route.lifecycle`
- validate lifecycle hook declarations during route registration
- make `SqsWorkerManager` own lifecycle execution with deterministic startup and shutdown ordering
- add startup-failure cleanup semantics that use reverse-order `afterStop` without invoking `beforeStop`
- keep `SqsWorkerServiceHost` and the Nest adapter thin by forwarding the shared route contract unchanged
- add route lifecycle examples and package-facing documentation for `beforeStart`, `afterStart`, `beforeStop`, and `afterStop`

## Test plan

- route registration rejects invalid lifecycle declarations
- startup runs `beforeStart` then `afterStart` in registration order
- failed startup runs reverse-order `afterStop` cleanup for routes whose `beforeStart` completed
- normal shutdown runs `beforeStop` before drain and `afterStop` after drain in reverse order
- stop-hook failures are aggregated after best-effort cleanup
- service-host and Nest integration preserve the shared lifecycle behavior
- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- lifecycle hooks remain code-owned only; manifests stay serializable and unchanged
- hooks stay zero-argument in this slice and rely on closure-captured resources
- no new runtime events, counters, or snapshot fields are added for lifecycle-hook failures
- `beforeStop` is a stop-signal hook; destructive cleanup belongs in `afterStop`
