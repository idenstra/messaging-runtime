# Releases

`messaging-runtime` is private-first. Releases are published only to GitHub Packages in this phase.

## Source of truth

- `package.json` version is the only release version source of truth
- every releasable commit must already contain:
  - the target version in `package.json`
  - the matching `CHANGELOG.md` section
  - green repo verification for that exact git state
- release tags use `v<package-version>`

This repo does not generate versions inside the workflow. Version bumps and changelog updates belong in reviewed git history.

## Current release posture

- registry: `https://npm.pkg.github.com`
- package: `@idenstra/messaging-runtime`
- package access: restricted/private
- release trigger: manual GitHub Actions workflow only
- release baseline: `main` HEAD only
- release concurrency: serialized; only one release workflow run at a time

Normal feature PRs never publish packages.

## Manual release workflow

The release workflow is `.github/workflows/release.yml`.

Inputs:
- `publish=false`
  - validates release readiness only
  - runs the guarded dry-run path
  - does not publish, tag, or create a GitHub release
- `publish=true`
  - runs the same validations
  - publishes the package to GitHub Packages
  - creates git tag `v<version>`
  - creates the matching GitHub release using the changelog entry

Validation before publish:
- `HARNESS_STRICT=1 make verify-fast`
- release-state validator confirms:
  - matching changelog section exists
  - package metadata is publishable
  - tag `v<version>` does not already exist
  - the same version is not already published
- `npm publish --dry-run`

## Local operator checks

Recommended local proof before running the workflow:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
node scripts/release/validate-release-state.mjs
make verify-fast
```

## Authentication

Workflow publication:
- GitHub Actions publishes with the repository `GITHUB_TOKEN`
- the workflow needs `contents: write` and `packages: write`

Local installs and local manual package inspection:
- use GitHub Packages auth in user space
- supported patterns:
  - a user-scoped npm config file
  - `npm login --auth-type=legacy --scope=@idenstra --registry=https://npm.pkg.github.com`
- do not commit auth tokens into repo `.npmrc`

The tracked repo `.npmrc` may contain only safe scope/registry mapping.
