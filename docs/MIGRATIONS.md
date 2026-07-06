# Migrations

This document is reserved for breaking-release upgrade guidance.

Routine release notes stay in [`../CHANGELOG.md`](../CHANGELOG.md). Use this document only when a release requires consumer code, config, or rollout changes.

## When migration notes are required

Add a section here for every future breaking release.

That includes changes such as:

- supported import-surface changes
- exported API changes that require consumer edits
- documented worker runtime semantics changes that require consumer changes
- Node baseline changes
- configuration changes that affect supported setup

## Section format for future breaking releases

Each breaking-release section should include:

1. target version
2. who is affected
3. what changed
4. required code or configuration changes
5. rollout or verification notes
6. links to the matching changelog entry and any focused docs

Recommended template:

```md
## 2.0.0

### Who is affected

- Consumers using ...

### What changed

- ...

### Required changes

1. Update ...
2. Replace ...

### Verification

- Run ...
- Confirm ...
```

## Current state

No breaking-release migration notes exist yet.

The package is still pre-`1.0`, and the `1.x` compatibility contract is being prepared before public cutover.
