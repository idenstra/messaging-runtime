# Reliability

The bootstrap repo should stay deterministic and cheap to verify.

Current reliability posture:
- validator self-tests run in CI
- package build/test run in CI
- no live queue integration in the bootstrap slice
- no Docker smoke lane in the bootstrap slice

When the real runtime code is extracted, reliability work should continue to favor:
- bounded failure modes
- explicit ack behavior
- deterministic shutdown behavior
- local or emulator-first tests

