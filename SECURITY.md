# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in `messaging-runtime`, do not open a public issue or pull request.

Use GitHub private vulnerability reporting for this repository whenever it is available. If you cannot use GitHub private reporting, contact the maintainers at `conduct@idenstra.com` and clearly label the message as a security report.

Please include:

- a clear description of the vulnerability
- affected versions or commit range when known
- reproduction steps or a minimal proof of concept
- impact assessment
- any suggested mitigation if you already have one

We will review reports as quickly as possible, confirm whether the issue is in scope, and coordinate remediation and disclosure timing with the reporter when appropriate.

## Scope

This file covers repository-level vulnerability disclosure and reporting.

For package-facing security boundaries such as IAM ownership, duplicate-processing expectations, message trust boundaries, and proof-lane safety, see [`docs/SECURITY.md`](docs/SECURITY.md).
