# Execution Plan

## Summary

Add a first-class finite-run execution surface to `@idenstra/messaging-runtime` so consumers can intentionally drain a worker until idle or run a bounded maintenance pass without falling back to ad hoc stop logic around the long-running worker lifecycle.

## Implementation changes

- add finite-run defaults, per-run options, result types, and lifecycle methods to the core and host public contracts
- add `runUntilIdle(...)` and `runBounded(...)` methods to `SqsWorkerManager` and `SqsWorkerServiceHost`, plus thin root-exported manager/host helpers
- track finite-run route state internally so idle completion uses configurable consecutive empty receives and bounded runs cap admission by handled messages per route
- reuse the existing stop/drain path so lifecycle hooks, timeout semantics, buffered drain, and delete finalization stay unchanged
- add direct-manager and service-host finite-run examples and package-facing docs that explain the difference between signal mode, idle drain, and bounded maintenance runs

## Test plan

- idle mode completes after the configured empty-wave threshold and still drains buffered/in-flight work before stop
- bounded mode enforces an exact per-route handled-message cap by folding buffered and in-flight work into receive demand
- finite-run methods reject when the manager or host is already started or stopping
- route lifecycle hooks, cooperative/abandon timeout behavior, and pending delete flush semantics remain unchanged under finite-run execution
- manager/host helper functions delegate to the same method surface
- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- finite-run configuration stays entrypoint-owned and is not added to worker manifests
- idle completion defaults to two consecutive empty receives per route but is configurable through manager defaults and per-run options
- bounded runs may still terminate early as `idle` when a route dries up before its handled-message cap is reached
- no new runtime events, snapshot fields, or scheduler modes are introduced in this slice
