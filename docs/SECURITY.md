# Security

Security expectations for this repo:

- do not commit credentials, tokens, or registry secrets
- do not hard-code private infrastructure assumptions into the package API
- keep CI and local verification free of live AWS requirements by default
- keep publication posture private-first until the explicit OSS-readiness slice changes that decision

Registry notes:
- GitHub Packages is the intended private-first registry target
- auth material for publication belongs in CI or operator environments, never in the repo

