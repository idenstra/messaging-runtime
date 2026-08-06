# `#11` Clean-history public `1.0` cutover

## Summary

Prepare the repository and package for a clean-history public `1.0.0` release without changing runtime behavior or the supported public API.

## Implementation

- set package and lockfile versions to `1.0.0`
- replace pre-public changelog history with an initial public release entry
- activate the documented `1.x` compatibility contract
- keep npmjs as the default install path and GitHub Packages as a restricted staged-release lane
- remove obsolete cutover documentation and completed execution-plan history
- scrub package-facing text for private history and organization-specific context
- rerun the accidental-export review and freeze all four supported entrypoints
- prepare the reviewed tree for a one-commit history replacement after this private PR merges

## Public surface

Supported imports remain exactly:

- `@idenstra/messaging-runtime`
- `@idenstra/messaging-runtime/core`
- `@idenstra/messaging-runtime/nest`
- `@idenstra/messaging-runtime/observability`

No exported symbol or runtime behavior changes in this slice.

## Proof

- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run public-surface:check`
- `npm pack --dry-run`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`
- optional LocalStack, observability, and live AWS lanes on the exact public root

## Cutover

After this private preparation PR merges, repository administration will remove historical tracker, pull-request, release, Actions, cache, tag, and Git surfaces. The clean public root excludes this completed plan.

Repository visibility remains private until the separately verified GitHub Packages `1.0.0` staging release succeeds.

## Assumptions

- the existing private-history backup is accepted outside this repository
- runtime behavior and exports remain unchanged
- npm publication happens only after the repository becomes public
- issue `#69` remains as the standalone public proof-lane follow-up
