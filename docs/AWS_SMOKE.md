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

## AWS SSO runbook

The documented maintainer path is AWS SSO plus explicit shell configuration:

```bash
export AWS_PROFILE=idenstra-admin
export AWS_REGION=us-east-1

aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity --profile "$AWS_PROFILE"

make verify-aws-smoke
```

Notes:

- `AWS_REGION` defaults to `us-east-1` if you do not set it.
- `AWS_PROFILE` is optional; if you omit it, the AWS SDK uses the normal default provider chain for the current shell.
- SSO is the documented path, but any credential source that satisfies the AWS SDK default provider chain is acceptable for this smoke.

## Safety posture

This lane provisions temporary queues, topics, and subscriptions outside the package API. That infrastructure exists only for the smoke and is deleted at the end of the run.

Fixture rules:

- all resources are prefixed with `mr58-<run-id>-...`
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

The smoke lane expects a maintainer profile or workflow role that can perform the AWS calls used by the harness:

- `sts:GetCallerIdentity`
- `sqs:CreateQueue`
- `sqs:DeleteQueue`
- `sqs:GetQueueAttributes`
- `sqs:GetQueueUrl`
- `sqs:ListDeadLetterSourceQueues`
- `sqs:ListMessageMoveTasks`
- `sqs:ReceiveMessage`
- `sqs:DeleteMessage`
- `sqs:DeleteMessageBatch`
- `sqs:ChangeMessageVisibility`
- `sqs:SendMessage`
- `sqs:SendMessageBatch`
- `sqs:SetQueueAttributes`
- `sqs:StartMessageMoveTask`
- `sqs:CancelMessageMoveTask`
- `sqs:ListQueues`
- `sns:CreateTopic`
- `sns:DeleteTopic`
- `sns:ListTopics`
- `sns:Publish`
- `sns:PublishBatch`
- `sns:Subscribe`
- `sns:SetSubscriptionAttributes`

If you lock the credentials down further, keep them scoped to temporary smoke resources in one region.

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

## Cleanup and interruption

Normal runs delete their own queues, topics, and subscriptions during teardown.

If the process is interrupted mid-run:

1. note the printed run ID;
2. list any leftover resources with that `mr58-<run-id>-...` prefix in the same region;
3. delete leftover topics first, then leftover queues;
4. if the interrupted run was inside the `redrive` suite, verify no message move task is still `RUNNING` before deleting the queues.

Because the resource names are unique per run, a stale resource is easy to identify and remove manually.

## GitHub workflow usage

This slice adds a dedicated manual workflow:

- `.github/workflows/aws-smoke.yml`

It supports:

- `workflow_dispatch`
- `workflow_call`

The manual workflow uses:

- GitHub OIDC
- `aws-actions/configure-aws-credentials`
- the repository variable or secret `AWS_SMOKE_ROLE_ARN`
- the same repo-owned `npm run e2e:aws-smoke:ci` runner

From the GitHub UI, choose the `Messaging Runtime AWS Smoke` workflow, select the suite list if needed, and run it against the target branch.

## Release gate behavior

The release workflow now treats AWS smoke as mandatory only for the real publish path:

- `publish=false`
  - runs the normal release preflight
  - stays AWS-free
  - does not call the AWS smoke workflow
- `publish=true`
  - runs the normal release preflight
  - runs the reusable AWS smoke workflow
  - only publishes if the AWS smoke job succeeds

This keeps routine release validation cheap while still enforcing real AWS proof before `npm publish`.

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
