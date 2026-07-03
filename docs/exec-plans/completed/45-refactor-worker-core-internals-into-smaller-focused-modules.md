# `#45` Refactor worker core internals into smaller focused modules

## Summary

Refactor the worker core from a single `src/core.ts` implementation into a folder-backed `src/core/` module set while preserving the public API, package exports, and current runtime semantics.

## Key changes

- move public worker-core types into `src/core/types.ts`
- move route validation and runtime constants into `src/core/config.ts`
- move worker-message normalization into `src/core/message.ts`
- move counter, snapshot, and infrastructure-event status handling into `src/core/status.ts`
- move internal runtime state types into `src/core/runtime-state.ts`
- move delete queueing and delete-finalization logic into `src/core/delete-batch.ts`
- move timeout, heartbeat, and buffered dispatch behavior into `src/core/processing.ts`
- keep `SqsWorkerManager` as the public class in `src/core/manager.ts`
- expose the public core surface through `src/core/index.ts`
- split the monolithic worker-core tests into focused `test/core/*.test.ts` suites with shared support helpers
- update package, public-surface, release, harness, and example path assumptions from `dist/core.d.ts` and `src/core.ts` to the folder-backed core entrypoint

## Proof

- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Notes

- no runtime-semantic changes are intended in this slice
- no public export additions or removals are intended in this slice
