# Execution Plan

## Summary

Add a dedicated public extension guide plus compile-checked examples that show how outside consumers can extend `messaging-runtime` safely without introducing provider-neutral abstractions or private-repo coupling.

## Implementation changes

- add `docs/EXTENDING.md` as the canonical product-facing extension guide
- add compile-checked examples for:
  - a wrapped transport client plus consumer-owned helper composition
  - a framework/process lifecycle bridge over `SqsWorkerServiceLifecycle`
- link the guide from:
  - `README.md`
  - `docs/README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/COMPATIBILITY.md`
- keep the guide aligned with the current public seams:
  - capability interfaces
  - root helper composition
  - host lifecycle seam
  - `@idenstra/messaging-runtime/observability`

## Test plan

- example scripts type-check through `examples/tsconfig.json`
- `npm run build`
- `npm run lint`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- this slice is docs/examples only
- no new public exports or runtime semantics are added
- extension examples stay generic and do not depend on sibling private repos
