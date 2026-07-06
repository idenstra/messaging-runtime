# `#71` Phase 1 public repository posture and contribution-facing cleanup

## Summary

Make the repository presentable to outside readers and contributors without changing runtime behavior or deciding the final public package registry posture yet.

## Implementation changes

- add the public community files:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `CODE_OF_CONDUCT.md`
  - root `SECURITY.md`
- align package metadata with the chosen public license
- rework issue and PR templates into a public-first hybrid set that keeps maintainer governance metadata available
- separate the consumer reading path from maintainer workflow docs while keeping `AGENTS.md` as the primary maintainer and AI-agent anchor
- scrub package-facing docs and examples for internal or organization-specific posture in consumer-facing sections

## Test plan

- run:
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `make audit`
  - `HARNESS_STRICT=1 make verify-fast`
- manually verify:
  - GitHub detects the repository license
  - root community files are coherent for outside readers
  - the consumer reading path stays consumer-first while maintainer docs remain discoverable

## Assumptions

- `#11` remains open for later public-release posture, registry, semver, and OSS-strategy work
- this slice does not change runtime behavior, public imports, or proof-lane semantics
- GitHub private vulnerability reporting is enabled separately in repository settings to match the new root `SECURITY.md`
