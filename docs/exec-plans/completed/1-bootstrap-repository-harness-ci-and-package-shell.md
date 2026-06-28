# `#1` Bootstrap repository harness, CI, and package shell

## Summary

Bootstrap `messaging-runtime` as the dedicated private-first home for the shared SNS/SQS runtime.

This slice covers:
- governance and harness surface
- single-package TypeScript shell
- CI baseline
- execution-plan lifecycle tooling

Related:
- `idenstra/platform#20`
- `idenstra/platform#18`

## Implementation changes

- add the standard repo governance docs adapted for a library repo
- add the governed PR template and issue forms
- add validator and harness scripts for deterministic local verification
- add the root package shell for `@idenstra/messaging-runtime`
- prepare private-first GitHub Packages metadata without publishing

## Test plan

- `make audit`
- `make verify-fast`
- `make verify`
- `make plan-sync`
- `npm ci`
- `npm test`
- `npm run build`

## Assumptions

- this repo stays private for now
- no real runtime source moves in this slice
- future extraction and feature work lives in follow-up issues

