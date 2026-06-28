# Reliability

This library repo should stay deterministic and cheap to verify.

Current reliability posture:
- validator self-tests run in CI
- package build/test run in CI
- no live queue integration in the current slice
- no Docker smoke lane in the current slice

Runtime reliability work should continue to favor:
- bounded failure modes
- explicit ack behavior
- deterministic shutdown behavior
- local or emulator-first tests
