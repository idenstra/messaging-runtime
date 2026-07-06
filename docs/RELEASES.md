# Releases

This is a contributor and maintainer workflow document for current registry and release mechanics.

`messaging-runtime` now has two distinct release postures:

- final public posture: npmjs is the default registry and public install path
- temporary private-transition posture: GitHub Packages is a tester lane for versions that need extra validation before npm promotion

The package metadata in `package.json` reflects the final public posture. GitHub Packages publication is a workflow-level override, not the package default.

## Source of truth

- `package.json` version is the only release version source of truth
- every releasable commit must already contain:
  - the target version in `package.json`
  - the matching `CHANGELOG.md` section
  - green repo verification for that exact git state
- release tags use `v<package-version>`
- npm promotion must use the exact git tag that was created by the earlier GitHub Packages publish step

This repo does not generate versions inside the workflow. Version bumps and changelog updates belong in reviewed git history.

## Current registry posture

- default public registry in `package.json`: `https://registry.npmjs.org`
- package: `@idenstra/messaging-runtime`
- public package access: `public`
- temporary tester lane: GitHub Packages at `https://npm.pkg.github.com`
- release trigger: manual GitHub Actions workflow only
- release baseline:
  - `main` for `validate` and `publish-github`
  - explicit git tag for `publish-npm`
- release concurrency: serialized; only one release workflow run at a time

Normal feature PRs never publish packages.

## Manual release workflow

The release workflow is `.github/workflows/release.yml`.

The workflow must be dispatched from `main`. If it is launched from any other ref, preflight fails before any release-only work runs.

Inputs:

- `mode=validate`
  - validates release readiness only
  - runs the guarded dry-run path
  - does not publish, tag, or create a GitHub release

- `mode=publish-github`
  - runs the same deterministic validations
  - runs the reusable live AWS smoke workflow against the exact checked-out `main` commit
  - publishes the package to GitHub Packages using the stable semver from `package.json`
  - creates git tag `v<version>`
  - does not create a GitHub release

- `mode=publish-npm`
  - requires `release-ref` such as `v0.3.0` or `0.3.0`
  - checks out that exact tag
  - reruns deterministic release validation on the tagged state
  - verifies the same version already exists on GitHub Packages
  - publishes that exact tagged version to npmjs
  - creates the matching GitHub release from that tagged state

## Transition-lane rules

- GitHub Packages is temporary and exists only for additional tester validation while the repo remains private.
- Same-version GitHub-first publication is allowed only in this transition period.
- Burned-version rule:
  - if `0.3.0` is published to GitHub Packages and later fails testing, `0.3.0` is never promoted to npm
  - the fix moves forward to `0.3.1` or later
- Smoke-gate rule:
  - `publish-github` must pass the full live AWS smoke gate
  - `publish-npm` does not rerun live AWS smoke because it promotes the exact tagged commit that already passed the GitHub Packages gate

## Validation before publish

Common preflight:

- `HARNESS_STRICT=1 make verify-fast`
- `npm publish --dry-run`
- release-state validator confirms the final public package posture:
  - package name stays `@idenstra/messaging-runtime`
  - `publishConfig` points to npmjs/public
  - `files`, `exports`, `types`, and Node baseline stay correct

Mode-specific validation:

- `validate` and `publish-github`
  - tag `v<version>` does not already exist
  - the same version does not already exist on GitHub Packages
  - the same version does not already exist on npmjs

- `publish-npm`
  - explicit `release-ref` is required
  - the checked-out tag matches `package.json` and `CHANGELOG.md`
  - the same version already exists on GitHub Packages
  - the same version does not yet exist on npmjs

## Local operator checks

Recommended local proof before dispatching the workflow:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
node scripts/release/validate-release-state.mjs
make verify-fast
```

When maintainers want the validator to exercise live tag and registry checks before dispatching a release, run:

```bash
node scripts/release/validate-release-state.mjs --mode publish-github --check-live-state
```

That live-state form requires working network access plus whatever registry authentication is needed to inspect GitHub Packages for the scoped package version.

For a GitHub Packages tester publish, the exact commit on `main` should already be the commit you are prepared to burn as that stable version if later testing finds a problem.

## Authentication

GitHub Packages publish:

- uses the repository `GITHUB_TOKEN`
- the workflow configures GitHub Packages auth at runtime
- the `publish-github` step overrides the npmjs default and publishes to `https://npm.pkg.github.com`

npmjs publish:

- uses npm trusted publishing / OIDC
- the workflow keeps `id-token: write` so npmjs can trust the GitHub Actions identity
- npm promotion stays tag-based and does not require a committed `.npmrc`

Live AWS smoke:

- the reusable AWS smoke workflow assumes the role declared by the repository or environment variable `AWS_SMOKE_ROLE_ARN`

Local installs and local inspection:

- public/default install target is npmjs once the package is publicly available
- while the repo is still private, maintainers can still use:
  - a local tarball from `npm pack`
  - GitHub Packages auth in user space when they need to test the transition lane directly

The tracked repository should not carry a scope-mapping `.npmrc`. Registry-specific auth and routing stay local or workflow-owned.
