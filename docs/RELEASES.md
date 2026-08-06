# Releases

This is a contributor and maintainer workflow document for registry and release mechanics.

The package has two deliberate destinations:

- npmjs is the public registry and default installation path
- GitHub Packages is a restricted tester lane for staging an exact release candidate before npm promotion

Package metadata always describes the npmjs posture. GitHub Packages publication is an explicit workflow override.

## Source of truth

- `package.json` is the release-version source of truth
- every releasable commit contains the target version and a matching `CHANGELOG.md` section
- release tags use `v<package-version>`
- npm promotion uses the exact tag created by the GitHub Packages publish step
- versions are never generated inside the workflow

Normal pull requests never publish packages.

## Manual workflow

The manual workflow is `.github/workflows/release.yml` and must be dispatched from `main`.

### `validate`

- verifies release readiness and performs a publish dry run
- creates no tag, package, or GitHub Release

### `publish-github`

- verifies the exact `main` commit
- runs the full live AWS smoke gate
- publishes the stable package version to restricted GitHub Packages
- creates tag `v<version>`
- does not create a GitHub Release

### `publish-npm`

- requires an explicit `release-ref`, such as `v1.0.0`
- checks out and validates that exact tag
- verifies the same version exists on GitHub Packages
- publishes the tagged package to npmjs with provenance
- creates the matching GitHub Release
- does not repeat live AWS smoke because the promoted commit already passed it

## Immutability

Publishing to GitHub Packages burns that stable version. If additional testing finds a defect, the version is not promoted to npm; the fix receives a later version.

Promotion never rebuilds from moving `main`. GitHub Packages, the git tag, npmjs, and the GitHub Release all identify the same reviewed commit.

## Validation

Common preflight includes:

- `HARNESS_STRICT=1 make verify-fast`
- `npm publish --dry-run`
- package-name, npmjs registry, public access, files, exports, types, and Node.js baseline validation

For `validate` and `publish-github`, the target tag and version must be absent from both registries.

For `publish-npm`:

- the explicit tag must exist and match `package.json` and `CHANGELOG.md`
- the checked-out commit must match the tag
- the version must exist on GitHub Packages
- the version must not exist on npmjs

Recommended local proof:

```bash
npm ci
npm test
npm run build
npm pack --dry-run
node scripts/release/validate-release-state.mjs
make verify-fast
```

Use live registry checks before a staged publish when credentials are available:

```bash
node scripts/release/validate-release-state.mjs --mode publish-github --check-live-state
```

## Authentication

GitHub Packages publication uses the repository `GITHUB_TOKEN` and workflow-owned registry configuration.

npmjs publication uses trusted publishing through GitHub Actions OIDC. The tracked repository does not contain registry credentials or a scope-mapping `.npmrc`.

Live AWS smoke assumes the role configured through the repository or environment variable `AWS_SMOKE_ROLE_ARN`.

Local consumers install from npmjs. Maintainers testing a staged version may configure GitHub Packages authentication in user space.
