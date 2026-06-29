# `#6` Worker service host, manifest-driven route activation, and signal runner

## Summary

Add the first bootstrap layer above the extracted runtime core:
- framework-agnostic worker-service host APIs
- manifest-driven route activation
- queue binding resolution through the injected resolver surface from `#5`
- Loafer-style signal runner ergonomics for consumer-owned worker entrypoints

This slice keeps the boundary clean:
- the runtime owns lifecycle, activation, validation, and graceful stop
- the consuming app still owns config sourcing and the final process entrypoint

Related:
- `idenstra/platform#24`
- `idenstra/CDP#180`

## Implementation changes

- add root-exported host/bootstrap APIs:
  - `SqsWorkerServiceRoute`
  - `SqsWorkerServiceManifest`
  - `SqsWorkerServiceHost`
  - `parseSqsWorkerServiceManifest`
  - `runSqsWorkerServiceUntilSignal`
- add a shared lifecycle contract so the Nest adapter works with either a raw `SqsWorkerManager` or the higher-level service host
- make manifest activation explicit:
  - routes absent from the manifest remain disabled
  - `enabled` defaults to `true` when a manifest entry exists
  - unknown manifest route names fail fast
  - active routes must resolve a queue identifier from manifest or route defaults
- keep activation queue-centric:
  - queue identifiers may be queue name, queue URL, or queue ARN
  - host resolution goes through the injected `SqsQueueUrlResolver`
  - no direct SNS-consumer activation is added here
- preserve the library boundary:
  - no direct env/file/secrets loading inside the package
  - no generic executable CLI
  - no consumer adoption in this slice
- update docs/examples so the worker bootstrap boundary is explicit

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `make verify-fast`
- `make verify`

## Assumptions

- the package owns bootstrap APIs, not the final worker binary
- apps still declare handlers in code and load config before constructing the host
- direct-manager usage remains supported, but worker services should prefer the host layer
