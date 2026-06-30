# AGENTS.md

## Purpose
Operational guide for contributors and agents working in `messaging-runtime`.

This repo owns the shared TypeScript SNS/SQS messaging runtime that consumer apps will embed into app-owned worker services.

It does not own business handlers, domain persistence, or application-specific worker behavior.

## Canonical docs
Read these first and use them intentionally:

- `WORKFLOW.md`: proof tiers, exception protocol, and handoff contract
- `docs/HARNESS.md`: one-page harness overview
- `docs/QUALITY_BAR.md`: engineering standards and review triggers
- `docs/AI_ENGINEERING.md`: AI working style for this repo
- `docs/EXECUTION_PLANS.md`: execution-plan requirements and lifecycle
- `docs/ISSUE_TRACKING.md`: `issue -> plan -> PR` workflow
- `docs/ARCHITECTURE.md`: runtime ownership and package boundaries
- `docs/SECURITY.md`: package, credential, and publication guardrails
- `docs/RELIABILITY.md`: deterministic verification and runtime expectations
- `scripts/README.md`: harness and validation script details

## Scope priority
1. runtime core behavior and public package surface
2. SNS/SQS-specific transport helpers
3. worker host/bootstrap ergonomics
4. testability, determinism, and harness quality
5. docs and release posture for private-first internal consumption

## Non-negotiable constraints
- Keep the repo SNS/SQS-specific. Do not broaden into Kafka, RabbitMQ, or generic broker abstractions.
- Keep a single package surface: `@idenstra/messaging-runtime`.
- Do not move consumer business handlers into this repo.
- Do not leak consumer- or repo-specific types into the package API.
- Keep local verification deterministic by default. Do not require live AWS for the harness gate.
- Any meaningful behavior change must update the relevant docs in the same change-set.
- Package publication remains private-first and is allowed only through the guarded manual release workflow.

## Repo layout contract
- `src/`: package source and exported runtime surface
- `test/`: package-level tests
- `scripts/ci/`: generic CI validators
- `scripts/harness/`: audit, verify, and execution-plan lifecycle tooling
- `docs/`: harness, architecture, reliability, and workflow docs

Rules:
- `src/` owns only shared runtime code and package-facing helpers.
- `test/` must stay consumer-agnostic.
- `scripts/` must not assume private infrastructure or sibling repos.
- `docs/` must describe the runtime itself, not internal app deployment behavior.

## Quality gates before merge
- Docs-only or governance-only changes:
  - `make audit`
- Package, harness, or validator changes:
  - `make verify-fast`
- Default final gate for this repo:
  - `make verify`

Execution-plan lifecycle:
- if the PR body closes a same-repo issue, treat that PR as the closeout PR
- move the linked plan into `docs/exec-plans/completed/` in the same change-set
- use `make plan-close ISSUE=<number>` for deliberate pre-merge closeout moves
- keep `make plan-sync` for stale closed-plan cleanup after issue closure

Local style helpers:
- `make format`
- `make lint`

## Documentation discipline
Any meaningful change must update the relevant docs in the same change-set:
- `README.md` for repo purpose and quick-start flow
- `WORKFLOW.md` for proof expectations
- this file when repo rules change
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, or `docs/RELIABILITY.md` when package boundaries or verification posture changes
- `docs/QUALITY_BAR.md` or `docs/AI_ENGINEERING.md` when contributor-style or AI-discipline rules change
