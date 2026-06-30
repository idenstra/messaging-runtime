# Public release readiness

This repository is not public-ready until the following readiness criteria are owned and resolved through tracked issue work. Making the repository visible before these items are resolved would weaken the maturity signal the package is meant to send.

## Repository posture

- Change repository visibility intentionally, not as a side effect of another slice.
- Decide and add the public license.
- Add `CONTRIBUTING.md`.
- Add `SECURITY.md` at the repository root or confirm GitHub security policy configuration.
- Add public issue templates.
- Add a public pull request template that does not assume private internal workflow knowledge.
- Remove or clearly separate internal-only governance docs from the consumer reading path.
- Audit docs and examples for private infrastructure, internal migration history, and confidential terms.

## Package metadata

- Replace `UNLICENSED` with the chosen public license in `package.json`.
- Decide whether public distribution uses npmjs, GitHub Packages, or both.
- Update `publishConfig` for the chosen public registry posture.
- Confirm package name and scope for public consumption.
- Confirm `files`, `exports`, `types`, and package tarball contents with `npm pack --dry-run`.
- Add README badges only for signals that are real and maintained.
- Add keywords and package metadata suitable for npm search if publishing publicly.

## API and compatibility

- Review the public export surface and remove accidental exports.
- Keep API Extractor reports and export snapshots aligned.
- Document the split between runtime clients and transport clients, or introduce a single SQS AWS adapter that satisfies both roles.
- Document the supported Node baseline and why it is `>=24`.
- Define the `1.0.0` criteria.
- Add migration notes for breaking changes while pre-`1.0`.

## Feature maturity

- Confirm parity coverage for core worker concepts: manager, route, handler, error hook, translator, SQS provider behavior, SNS-over-SQS decoding, and publisher helpers.
- Add optional emulator or integration tests for receive, delete, visibility heartbeat, SQS publish, SNS publish, queue resolution, and topic resolution.
- Document idempotency, duplicate processing, DLQ, redrive, and poison-message ownership.
- Document FIFO queue considerations: message group ID, deduplication ID, ordering, concurrency, and batch behavior.
- Document LocalStack or emulator setup if an emulator lane is added.

## Performance maturity

- Add the benchmark suite described in [`PERFORMANCE.md`](PERFORMANCE.md).
- Commit a benchmark baseline.
- Add benchmark regression guidance for PR review.
- Publish benchmark methodology before making speed claims.
- Avoid marketing terms such as "blazingly fast" until evidence exists.

## CI and release maturity

- Ensure public pull requests can run safe checks without private secrets.
- Keep release publication manual and guarded.
- Use least-privilege workflow permissions.
- Confirm release provenance requirements for the chosen registry.
- Confirm changelog entries are suitable for public readers.
- Confirm tags, GitHub releases, and package versions stay aligned.

## Documentation maturity

- Make the root README concise and consumer-first.
- Keep the first-run example correct and copy-pasteable.
- Keep public docs in a clear order through [`docs/README.md`](README.md).
- Separate product docs from contributor/governance docs.
- Document production adoption prerequisites.
- Document current limitations directly instead of hiding them in issue references.

## Release decision

The public-release decision should be made only after the remaining readiness items have explicit owners in the issue tracker and the package has a passing verification run for the exact commit that will become public.
