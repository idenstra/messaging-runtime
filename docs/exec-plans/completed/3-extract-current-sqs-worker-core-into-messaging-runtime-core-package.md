# `#3` Extract current SQS worker core into messaging-runtime core package

## Summary

Move the current SQS worker runtime source out of `platform` and make `messaging-runtime` the canonical owner of the shared package code.

This slice covers:
- moving the current runtime source and tests
- aligning the package dependencies with the extracted code
- updating docs and harness expectations so the repo reflects runtime ownership
- removing the old source of truth from `platform`

Related:
- `idenstra/platform#18`
- `idenstra/CDP#180`

## Implementation changes

- add the current runtime source files to `src/`
- add the current runtime behavior tests to `test/`
- keep the package flat and SNS/SQS-specific
- update the repo docs and audit so they expect real runtime code rather than a bootstrap shell
- remove the old runtime package from `platform` and its harness-owned package manifest

## Test plan

- `npm ci`
- `npm test`
- `npm run build`
- `make audit`
- `make verify-fast`
- `make verify`
- `make plan-sync`
- `HARNESS_STRICT=1 make verify-fast` in `platform`

## Assumptions

- consumer adoption remains deferred
- package publication/release automation remains deferred
- public-surface expansion is out of scope for this slice
