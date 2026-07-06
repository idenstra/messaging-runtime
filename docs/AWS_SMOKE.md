# Live AWS Smoke

`messaging-runtime` keeps live AWS validation separate from the default harness and from the LocalStack and observability-local lanes.

Use this lane when:

- the deterministic harness is already green;
- the LocalStack lane is already green;
- the observability lane is already green when the change touches OTEL metrics, worker tracing, or W3C propagation; and
- you still need confidence that the built package behaves correctly against real AWS SNS/SQS APIs.

This lane is optional for normal development and PR work. It is not part of `make verify-fast` or the default CI lanes. It is, however, the required AWS confidence gate before a real package publish.

## Command surface

Standard local entrypoints:

```bash
make verify-aws-smoke
npm run e2e:aws-smoke
npm run e2e:aws-smoke:ci
```

Supported suite names:

- `transport`
- `worker`
- `routing`
- `discovery`
- `queue-ops`
- `redrive`

Subset execution is supported:

```bash
npm run e2e:aws-smoke -- --suite transport,worker
npm run e2e:aws-smoke -- --suite redrive
```

The `:ci` variant is the same repo-owned runner used by the manual GitHub workflow and the release-time publish gate.

If you are validating the library in your own AWS account, start with the public self-test path below.

## Public self-test path

If you are validating `messaging-runtime` against your own AWS account, use the local smoke lane directly. You do not need access to any upstream maintainer account, workflow, or IAM role.

Prerequisites:

- an AWS account or sandbox where you can create and delete temporary SNS/SQS fixtures
- credentials available through the AWS SDK default provider chain
- Node.js `>=24`
- `npm ci`

The simplest path is one named local profile:

```bash
export AWS_PROFILE=my-sandbox
export AWS_REGION=us-east-1

aws sts get-caller-identity --profile "$AWS_PROFILE"

make verify-aws-smoke
```

Subset execution is supported when you only want one feature family:

```bash
npm run e2e:aws-smoke -- --suite transport,worker
npm run e2e:aws-smoke -- --suite redrive
```

Notes:

- `AWS_REGION` defaults to `us-east-1` if you do not set it.
- `AWS_PROFILE` is optional; if you omit it, the AWS SDK uses the normal default provider chain for the current shell.
- AWS SSO is one valid way to obtain credentials, but it is not required. Static credentials, `aws-vault`, and any other credential source accepted by the AWS SDK are also valid.
- The local smoke lane builds the package, provisions temporary fixtures, runs the selected suites, and deletes its own resources during teardown.

### Minimal IAM policy for your own account

If you want to lock the smoke lane to temporary resources in your own sandbox account, use the IAM action set below and scope the resources to a prefix you control, such as `messaging-runtime-*` in one region.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StsIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    },
    {
      "Sid": "SqsSmokeQueues",
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:DeleteQueue",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ListDeadLetterSourceQueues",
        "sqs:ListMessageMoveTasks",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:SendMessage",
        "sqs:SetQueueAttributes",
        "sqs:StartMessageMoveTask",
        "sqs:CancelMessageMoveTask"
      ],
      "Resource": "arn:aws:sqs:us-east-1:<ACCOUNT_ID>:messaging-runtime-*"
    },
    {
      "Sid": "SqsListQueues",
      "Effect": "Allow",
      "Action": "sqs:ListQueues",
      "Resource": "arn:aws:sqs:us-east-1:<ACCOUNT_ID>:*"
    },
    {
      "Sid": "SnsSmokeTopics",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:DeleteTopic",
        "sns:Publish",
        "sns:Subscribe"
      ],
      "Resource": "arn:aws:sns:us-east-1:<ACCOUNT_ID>:messaging-runtime-*"
    },
    {
      "Sid": "SnsListAndSubscriptionAttrs",
      "Effect": "Allow",
      "Action": [
        "sns:ListTopics",
        "sns:SetSubscriptionAttributes"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-east-1"
        }
      }
    }
  ]
}
```

Replace `<ACCOUNT_ID>` with your own AWS account ID. Batch AWS APIs exercised by this lane reuse the base IAM actions above:

- `sqs:DeleteMessage` covers `DeleteMessageBatch`
- `sqs:SendMessage` covers `SendMessageBatch`
- `sns:Publish` covers `PublishBatch`

### Cleanup and interruption

Normal runs delete their own queues, topics, and subscriptions during teardown.

If the process is interrupted mid-run:

1. note the printed run ID;
2. list any leftover resources with that `messaging-runtime-<run-id>-...` prefix in the same region;
3. delete leftover topics first, then leftover queues;
4. if the interrupted run was inside the `redrive` suite, verify no message move task is still `RUNNING` before deleting the queues.

Because the resource names are unique per run, a stale resource is easy to identify and remove manually.

## Maintainer workflow for this repository

If you are maintaining `idenstra/messaging-runtime` itself, this repository also owns a maintainer workflow path for release-time confidence on `main`.

That path uses:

- AWS SSO locally for maintainers who want to run the smoke from their own shell
- GitHub OIDC for the repo-owned workflow
- the repository or environment variable `AWS_SMOKE_ROLE_ARN`
- a trust policy locked to `repo:idenstra/messaging-runtime:ref:refs/heads/main`
- a release workflow where `publish-github` runs AWS smoke before the GitHub Packages tester publish, and later `publish-npm` promotes the exact tagged commit to npm without rerunning AWS smoke

An example local maintainer shell looks like:

```bash
export AWS_PROFILE=maintainer-sandbox
export AWS_REGION=us-east-1

aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity --profile "$AWS_PROFILE"

make verify-aws-smoke
```

The maintainer-specific OIDC role and workflow are not part of the public package API. They exist only to validate and publish the upstream repository safely.

For outside consumers, the public self-test path above is the canonical path. The maintainer workflow is an upstream repository operation, not a requirement for adopting the library.

## Fork workflow path

If you fork this repository and want the GitHub workflow to run against your own AWS account, you must create your own AWS role, variable, and trust policy in your own repo.

Do not expect the upstream `idenstra/messaging-runtime` workflow or `AWS_SMOKE_ROLE_ARN` value to work for your fork.

The fork owner should:

1. create a sandbox IAM role in their own AWS account;
2. create or reuse the GitHub OIDC trust setup for `token.actions.githubusercontent.com`;
3. lock the trust policy to their own repository and branch or environment;
4. add `AWS_SMOKE_ROLE_ARN` as a repository or environment variable in their own fork;
5. run the same `Messaging Runtime AWS Smoke` workflow there.

For an exact-branch trust policy, the key condition looks like:

```json
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:ref:refs/heads/main"
  }
}
```

## Safety posture

This lane provisions temporary queues, topics, and subscriptions outside the package API. That infrastructure exists only for the smoke and is deleted at the end of the run.

Fixture rules:

- all resources are prefixed with `messaging-runtime-<run-id>-...`
- the runner prints the run ID before provisioning
- the runner rejects LocalStack or custom endpoint overrides such as:
  - `MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT`
  - `AWS_ENDPOINT_URL`
  - `AWS_ENDPOINT_URL_SQS`
  - `AWS_ENDPOINT_URL_SNS`
- the runner rejects obvious test credentials such as `AWS_ACCESS_KEY_ID=test`
- the lane uses small, low-volume SNS/SQS fixtures only
- the dedicated redrive suite uses its own source-queue + DLQ fixture pair

This lane does not operationalize queue or topic lifecycle through the published package surface. Provisioning is test-harness-only.

## IAM scope

The smoke lane expects credentials that can perform the AWS calls used by the harness:

- `sts:GetCallerIdentity`
- `sqs:CreateQueue`
- `sqs:DeleteQueue`
- `sqs:GetQueueAttributes`
- `sqs:GetQueueUrl`
- `sqs:ListDeadLetterSourceQueues`
- `sqs:ListMessageMoveTasks`
- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:ChangeMessageVisibility`
- `sqs:SendMessage`
- `sqs:SetQueueAttributes`
- `sqs:StartMessageMoveTask`
- `sqs:CancelMessageMoveTask`
- `sqs:ListQueues`
- `sns:CreateTopic`
- `sns:DeleteTopic`
- `sns:ListTopics`
- `sns:Publish`
- `sns:Subscribe`
- `sns:SetSubscriptionAttributes`

If you lock the credentials down further, keep them scoped to temporary `messaging-runtime-*` smoke resources in one region.

## What the lane proves

Current live AWS smoke coverage includes:

- queue URL resolution by name, URL, and ARN
- topic ARN resolution by name and ARN
- queue discovery with prefix filtering
- topic discovery against real AWS topic listings
- queue inspection against real queue attributes
- dead-letter source-queue listing
- SQS publisher surface:
  - `sendJson(...)`
  - `sendString(...)`
  - `sendSerialized(...)`
  - `sendJsonBatch(...)`
  - `sendStringBatch(...)`
  - `sendSerializedBatch(...)`
- SNS publisher surface:
  - `publishJson(...)`
  - `publishString(...)`
  - `publishSerialized(...)`
  - `publishJsonBatch(...)`
  - `publishStringBatch(...)`
  - `publishSerializedBatch(...)`
  - `publishStructuredJson(...)`
  - `publishStructuredJsonBatch(...)`
- raw SNS -> SQS delivery through real AWS subscriptions
- envelope SNS -> SQS decode through `snsJsonQueueRoute(...)`
- message-attribute propagation through:
  - SQS string and number attribute builders
  - SNS string and `String.Array` attribute builders
  - raw attribute-map passthrough
- hosted worker receive/delete flow through `SqsWorkerServiceHost.runBounded(...)`
- route lifecycle hooks during a real hosted worker run
- finite-run execution through `runBounded(...)`
- FIFO `ReceiveRequestAttemptId` request-shape proof through a thin recording wrapper over the real SQS client
- forwarding helpers:
  - queue-to-queue
  - queue-to-topic
- dedicated native DLQ redrive proof through:
  - real source-queue + DLQ fixtures
  - `inspectQueue(...)`
  - `listDeadLetterSourceQueues(...)`
  - `startRedrive(...)`
  - `listRedriveTasks(...)`
  - `cancelRedrive(...)`

The lane is organized around feature families, not every helper permutation.

## GitHub workflow usage

This slice adds a dedicated manual workflow:

- `.github/workflows/aws-smoke.yml`

It supports:

- `workflow_dispatch`
- `workflow_call`

The upstream manual workflow uses:

- GitHub OIDC
- `aws-actions/configure-aws-credentials`
- the repository or environment variable `AWS_SMOKE_ROLE_ARN`
- the same repo-owned `npm run e2e:aws-smoke:ci` runner

From the GitHub UI, choose the `Messaging Runtime AWS Smoke` workflow, select the suite list if needed, and run it against the target branch.

## Release gate behavior

The release workflow now treats AWS smoke as mandatory only for the GitHub Packages tester-publish path:

- `mode=validate`
  - runs the normal release preflight
  - stays AWS-free
  - does not call the AWS smoke workflow
- `mode=publish-github`
  - runs the normal release preflight for the exact `main` commit being published
  - runs the reusable AWS smoke workflow
  - only publishes to GitHub Packages and creates the git tag if the AWS smoke job succeeds
- `mode=publish-npm`
  - checks out the explicit promotion tag
  - stays AWS-free because it promotes the exact tagged commit that already passed `publish-github`
  - only publishes to npm if the matching version is already present on GitHub Packages

This keeps routine release validation cheap while still enforcing real AWS proof before a version enters the tester lane and before that exact version can later be promoted publicly.

## When to escalate to live AWS

Prefer this order:

1. `make audit`
2. `HARNESS_STRICT=1 make verify-fast`
3. `make verify-localstack`
4. `make verify-observability` when the change touches OTEL/tracing/propagation
5. `make verify-aws-smoke`

Use the live AWS lane when:

- LocalStack cannot answer a behavior question cleanly;
- a change touched real SNS/SQS semantics that are worth one last AWS check before review or release;
- the change touched discovery, queue inspection, or native redrive behavior;
- release readiness needs AWS-backed confidence for maintainers.
