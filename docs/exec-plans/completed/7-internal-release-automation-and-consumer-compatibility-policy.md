# Execution Plan

## Summary

Implement the private-first release/governance slice for `@idenstra/messaging-runtime`:
- make the package publishable to GitHub Packages
- define the exact-version `0.x` consumer policy
- add guarded manual release automation
- add deterministic release-state validation to the harness

## Implementation changes

- add `CHANGELOG.md`, `docs/RELEASES.md`, and `docs/COMPATIBILITY.md` as the release-policy source of truth
- remove the blocking `private: true` package posture while keeping GitHub Packages as the only supported registry
- add release-state validation and changelog note extraction scripts under `scripts/release/`
- add manual `.github/workflows/release.yml` with dry-run and publish modes
- extend `verify-fast`, audit, and repo docs so release drift is caught before publication

## Test plan

- `npm test`
- `npm run build`
- `npm pack --dry-run`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`
- local release validator tests covering changelog, metadata, duplicate tag, and duplicate published version behavior

## Assumptions

- publication remains private-first and GitHub-Packages-only
- consumer adoption is a later slice
- exact version pinning remains the default while the package is `0.x`
