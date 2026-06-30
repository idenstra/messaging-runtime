# `#24` Adapter ergonomics and naming parity

## Summary

Unify the public AWS adapter surface so consumers wire one SQS adapter and one SNS adapter instead of reasoning about internal capability splits.

Locked decisions:
- keep `SqsRuntimeClient`, `SqsTransportClient`, and `SnsTransportClient` as separate interfaces
- add `AwsSqsAdapter` and `AwsSnsAdapter`
- remove `AwsSqsRuntimeClient`, `AwsSqsTransportClient`, and `AwsSnsTransportClient`
- do not add `SnsRuntimeClient`
- do not keep deprecation bridges

Related:
- `#2`
- `#11`

## Implementation changes

- add `AwsSqsAdapter` that wraps one AWS SDK `SQSClient` and implements both runtime and transport interfaces
- rename `AwsSnsTransportClient` to `AwsSnsAdapter`
- remove the split public AWS wrapper classes from the supported package surface
- keep host, resolver, publisher, and interface contracts unchanged
- rewrite `README.md` and package docs to use the combined adapter contract only
- update public-surface reports, export snapshots, and changelog to reflect the new contract

## Test plan

- `npm test`
- `npm run build`
- `make audit`
- `HARNESS_STRICT=1 make verify-fast`

## Assumptions

- no downstream consumer relies on the removed wrapper names yet
- the interface split remains valuable internally even though the public AWS wrappers become unified
- SNS remains publish/resolve-only until the package owns a real SNS runtime lifecycle
