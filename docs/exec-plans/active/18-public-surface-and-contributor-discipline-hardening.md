# `#18` Public surface and contributor-discipline hardening

Implement a public-library hardening pass for `messaging-runtime` on top of the strict Biome/style baseline.

Goals:
- keep style/format enforcement inside the mandatory CI gate
- enforce the supported package import surface:
  - `@idenstra/messaging-runtime`
  - `@idenstra/messaging-runtime/core`
  - `@idenstra/messaging-runtime/nest`
- make exported public-surface drift visible in normal PR diffs through:
  - checked-in package-interface report files
  - a lighter custom export snapshot
- remove and then block consumer- and repo-specific leakage in tracked source/docs

Implementation outline:
- add a deep-import validator plus tests
- add public-surface report configs, package-interface report generation, check scripts, and committed reports
- add a custom export-snapshot generator, checked-in outputs, and drift checks
- add a package-facing reference-hygiene validator without embedding internal repo names into the library
- clean tracked docs/examples so the new validator passes
- keep `make verify-fast` as the one authoritative CI gate for lint, tests, build, public-surface drift, and harness checks

Proof:
- `npm run lint`
- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

Notes:
- `./core` remains a supported public subpath in this slice
- package docs should describe the library contract only, not internal consumer repos
