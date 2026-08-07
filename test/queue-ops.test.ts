import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GetQueueUrlCommandInput,
  ListDeadLetterSourceQueuesCommandInput,
  ListMessageMoveTasksCommandInput,
  QueueAttributeName,
  StartMessageMoveTaskCommandInput,
} from '@aws-sdk/client-sqs';
import {
  SqsDlqRedriveManager,
  SqsQueueInspector,
  type SqsQueueOperationsClient,
  type SqsQueueUrlResolverClient,
} from '../src';

type QueueAttributes = Partial<Record<QueueAttributeName, string>>;

const SOURCE_QUEUE_NAME = 'jobs-dlq';
const SOURCE_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-dlq';
const SOURCE_QUEUE_ARN = 'arn:aws:sqs:us-east-1:123456789012:jobs-dlq';
const DESTINATION_QUEUE_NAME = 'jobs-recovery';
const DESTINATION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-recovery';
const DESTINATION_QUEUE_ARN = 'arn:aws:sqs:us-east-1:123456789012:jobs-recovery';

class FakeSqsQueueOperationsClient implements SqsQueueOperationsClient, SqsQueueUrlResolverClient {
  readonly getQueueUrlInputs: GetQueueUrlCommandInput[] = [];
  readonly getQueueAttributesInputs: Array<{ QueueUrl?: string; AttributeNames?: QueueAttributeName[] }> = [];
  readonly listDeadLetterSourceQueuesInputs: ListDeadLetterSourceQueuesCommandInput[] = [];
  readonly startMessageMoveTaskInputs: StartMessageMoveTaskCommandInput[] = [];
  readonly listMessageMoveTasksInputs: ListMessageMoveTasksCommandInput[] = [];
  readonly cancelMessageMoveTaskInputs: Array<{ TaskHandle?: string }> = [];

  readonly startMessageMoveTaskResponse: { TaskHandle?: string } = { TaskHandle: 'task-1' };
  readonly cancelMessageMoveTaskResponse: { ApproximateNumberOfMessagesMoved?: number } = {
    ApproximateNumberOfMessagesMoved: 7,
  };

  private readonly queueUrls = new Map<string, string>();
  private readonly attributesByQueueUrl = new Map<string, QueueAttributes>();
  private readonly deadLetterSourceQueuePages = new Map<string, Array<{ queueUrls?: string[]; NextToken?: string }>>();
  private readonly moveTaskResponses = new Map<
    string,
    Array<{
      Results?: Array<{
        TaskHandle?: string;
        Status?: string;
        SourceArn?: string;
        DestinationArn?: string;
        MaxNumberOfMessagesPerSecond?: number;
        ApproximateNumberOfMessagesMoved?: number;
        ApproximateNumberOfMessagesToMove?: number;
        FailureReason?: string;
        StartedTimestamp?: number;
      }>;
    }>
  >();

  withQueue(queueName: string, queueUrl: string, attributes: QueueAttributes): this {
    this.queueUrls.set(queueName, queueUrl);
    this.attributesByQueueUrl.set(queueUrl, attributes);
    return this;
  }

  withDeadLetterSourceQueuePages(queueUrl: string, pages: Array<{ queueUrls?: string[]; NextToken?: string }>): this {
    this.deadLetterSourceQueuePages.set(queueUrl, [...pages]);
    return this;
  }

  withMoveTaskResponses(
    sourceArn: string,
    responses: Array<{
      Results?: Array<{
        TaskHandle?: string;
        Status?: string;
        SourceArn?: string;
        DestinationArn?: string;
        MaxNumberOfMessagesPerSecond?: number;
        ApproximateNumberOfMessagesMoved?: number;
        ApproximateNumberOfMessagesToMove?: number;
        FailureReason?: string;
        StartedTimestamp?: number;
      }>;
    }>,
  ): this {
    this.moveTaskResponses.set(sourceArn, [...responses]);
    return this;
  }

  async getQueueUrl(input: GetQueueUrlCommandInput) {
    this.getQueueUrlInputs.push(input);
    return { QueueUrl: input.QueueName ? this.queueUrls.get(input.QueueName) : undefined };
  }

  async getQueueAttributes(input: { QueueUrl?: string; AttributeNames?: QueueAttributeName[] }) {
    this.getQueueAttributesInputs.push(input);
    return { Attributes: input.QueueUrl ? this.attributesByQueueUrl.get(input.QueueUrl) : undefined };
  }

  async listDeadLetterSourceQueues(input: ListDeadLetterSourceQueuesCommandInput) {
    this.listDeadLetterSourceQueuesInputs.push(input);
    const pages = input.QueueUrl ? this.deadLetterSourceQueuePages.get(input.QueueUrl) : undefined;
    return pages?.shift() ?? { queueUrls: [] };
  }

  async startMessageMoveTask(input: StartMessageMoveTaskCommandInput) {
    this.startMessageMoveTaskInputs.push(input);
    return this.startMessageMoveTaskResponse;
  }

  async listMessageMoveTasks(input: ListMessageMoveTasksCommandInput) {
    this.listMessageMoveTasksInputs.push(input);
    const responses = input.SourceArn ? this.moveTaskResponses.get(input.SourceArn) : undefined;
    return responses?.shift() ?? { Results: [] };
  }

  async cancelMessageMoveTask(input: { TaskHandle?: string }) {
    this.cancelMessageMoveTaskInputs.push(input);
    return this.cancelMessageMoveTaskResponse;
  }
}

function createDlqAttributes(queueArn = SOURCE_QUEUE_ARN): QueueAttributes {
  return {
    QueueArn: queueArn,
    FifoQueue: 'true',
    ApproximateNumberOfMessages: '12',
    ApproximateNumberOfMessagesNotVisible: '4',
    ApproximateNumberOfMessagesDelayed: '2',
    VisibilityTimeout: '30',
    MessageRetentionPeriod: '1209600',
    ReceiveMessageWaitTimeSeconds: '20',
    DelaySeconds: '0',
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:jobs-poison-dlq',
      maxReceiveCount: '5',
    }),
    RedriveAllowPolicy: JSON.stringify({
      redrivePermission: 'byQueue',
      sourceQueueArns: ['arn:aws:sqs:us-east-1:123456789012:jobs'],
    }),
  };
}

function createStandardQueueAttributes(queueArn = 'arn:aws:sqs:us-east-1:123456789012:jobs'): QueueAttributes {
  return {
    QueueArn: queueArn,
    ApproximateNumberOfMessages: '1',
    ApproximateNumberOfMessagesNotVisible: '0',
    ApproximateNumberOfMessagesDelayed: '0',
    VisibilityTimeout: '30',
    MessageRetentionPeriod: '345600',
    ReceiveMessageWaitTimeSeconds: '10',
    DelaySeconds: '0',
  };
}

test('SqsQueueInspector resolves queue names, URLs, and ARNs and normalizes queue attributes', async () => {
  const client = new FakeSqsQueueOperationsClient().withQueue(
    SOURCE_QUEUE_NAME,
    SOURCE_QUEUE_URL,
    createDlqAttributes(),
  );
  const inspector = new SqsQueueInspector(client);

  const inspectedByName = await inspector.inspectQueue(SOURCE_QUEUE_NAME);
  const inspectedByUrl = await inspector.inspectQueue(SOURCE_QUEUE_URL);
  const inspectedByArn = await inspector.inspectQueue(SOURCE_QUEUE_ARN);

  assert.equal(client.getQueueUrlInputs.length, 1);
  assert.equal(inspectedByName.queueUrl, SOURCE_QUEUE_URL);
  assert.equal(inspectedByName.queueArn, SOURCE_QUEUE_ARN);
  assert.equal(inspectedByName.queueName, SOURCE_QUEUE_NAME);
  assert.equal(inspectedByName.fifo, true);
  assert.equal(inspectedByName.approximateNumberOfMessages, 12);
  assert.equal(inspectedByName.approximateNumberOfMessagesNotVisible, 4);
  assert.equal(inspectedByName.approximateNumberOfMessagesDelayed, 2);
  assert.equal(inspectedByName.visibilityTimeoutSeconds, 30);
  assert.equal(inspectedByName.messageRetentionSeconds, 1_209_600);
  assert.equal(inspectedByName.receiveMessageWaitTimeSeconds, 20);
  assert.equal(inspectedByName.delaySeconds, 0);
  assert.deepEqual(inspectedByName.redrivePolicy, {
    deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:jobs-poison-dlq',
    maxReceiveCount: 5,
    raw: { deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:jobs-poison-dlq', maxReceiveCount: '5' },
  });
  assert.deepEqual(inspectedByName.redriveAllowPolicy, {
    redrivePermission: 'byQueue',
    sourceQueueArns: ['arn:aws:sqs:us-east-1:123456789012:jobs'],
    raw: { redrivePermission: 'byQueue', sourceQueueArns: ['arn:aws:sqs:us-east-1:123456789012:jobs'] },
  });
  assert.equal(inspectedByUrl.queueIdentifier, SOURCE_QUEUE_URL);
  assert.equal(inspectedByArn.queueIdentifier, SOURCE_QUEUE_ARN);
});

test('SqsQueueInspector paginates dead-letter source queues', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withDeadLetterSourceQueuePages(SOURCE_QUEUE_URL, [
      { queueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789012/jobs-primary'], NextToken: 'page-2' },
      { queueUrls: ['https://sqs.us-east-1.amazonaws.com/123456789012/jobs-secondary'] },
    ]);
  const inspector = new SqsQueueInspector(client);

  const result = await inspector.listDeadLetterSourceQueues(SOURCE_QUEUE_NAME, { pageSize: 1 });

  assert.deepEqual(result, {
    queueIdentifier: SOURCE_QUEUE_NAME,
    queueUrl: SOURCE_QUEUE_URL,
    queueArn: SOURCE_QUEUE_ARN,
    sourceQueueUrls: [
      'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-primary',
      'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-secondary',
    ],
  });
  assert.deepEqual(client.listDeadLetterSourceQueuesInputs, [
    { QueueUrl: SOURCE_QUEUE_URL, MaxResults: 1, NextToken: undefined },
    { QueueUrl: SOURCE_QUEUE_URL, MaxResults: 1, NextToken: 'page-2' },
  ]);
});

test('SqsQueueInspector requests FifoQueue only for FIFO queue URLs and infers standard queues without it', async () => {
  const standardQueueName = 'jobs-standard';
  const standardQueueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-standard';
  const standardQueueArn = 'arn:aws:sqs:us-east-1:123456789012:jobs-standard';
  const fifoQueueName = 'jobs-standard.fifo';
  const fifoQueueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-standard.fifo';
  const fifoQueueArn = 'arn:aws:sqs:us-east-1:123456789012:jobs-standard.fifo';

  const client = new FakeSqsQueueOperationsClient()
    .withQueue(standardQueueName, standardQueueUrl, createStandardQueueAttributes(standardQueueArn))
    .withQueue(fifoQueueName, fifoQueueUrl, createDlqAttributes(fifoQueueArn));
  const inspector = new SqsQueueInspector(client);

  const standardDescription = await inspector.inspectQueue(standardQueueName);
  const fifoDescription = await inspector.inspectQueue(fifoQueueName);

  assert.equal(standardDescription.queueArn, standardQueueArn);
  assert.equal(standardDescription.fifo, false);
  assert.equal(fifoDescription.queueArn, fifoQueueArn);
  assert.equal(fifoDescription.fifo, true);
  assert.equal(client.getQueueAttributesInputs[0]?.AttributeNames?.includes('FifoQueue') ?? false, false);
  assert.equal(client.getQueueAttributesInputs[1]?.AttributeNames?.includes('FifoQueue') ?? false, true);
});

test('SqsDlqRedriveManager lists move tasks with normalized metadata', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withMoveTaskResponses(SOURCE_QUEUE_ARN, [
      {
        Results: [
          {
            TaskHandle: 'task-7',
            Status: 'FAILED',
            SourceArn: SOURCE_QUEUE_ARN,
            DestinationArn: DESTINATION_QUEUE_ARN,
            MaxNumberOfMessagesPerSecond: 25,
            ApproximateNumberOfMessagesMoved: 3,
            ApproximateNumberOfMessagesToMove: 10,
            FailureReason: 'permissions',
            StartedTimestamp: 1_719_788_800_000,
          },
        ],
      },
    ]);
  const manager = new SqsDlqRedriveManager(client);

  const result = await manager.listRedriveTasks({ sourceQueue: SOURCE_QUEUE_NAME, maxResults: 5 });

  assert.deepEqual(result, {
    sourceQueueIdentifier: SOURCE_QUEUE_NAME,
    sourceQueueUrl: SOURCE_QUEUE_URL,
    sourceQueueArn: SOURCE_QUEUE_ARN,
    tasks: [
      {
        taskHandle: 'task-7',
        status: 'FAILED',
        sourceArn: SOURCE_QUEUE_ARN,
        destinationArn: DESTINATION_QUEUE_ARN,
        maxMessagesPerSecond: 25,
        approximateNumberOfMessagesMoved: 3,
        approximateNumberOfMessagesToMove: 10,
        failureReason: 'permissions',
        startedTimestamp: 1_719_788_800_000,
      },
    ],
  });
  assert.deepEqual(client.listMessageMoveTasksInputs, [{ SourceArn: SOURCE_QUEUE_ARN, MaxResults: 5 }]);
});

test('SqsDlqRedriveManager starts native redrive with an explicit destination queue', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withQueue(DESTINATION_QUEUE_NAME, DESTINATION_QUEUE_URL, createDlqAttributes(DESTINATION_QUEUE_ARN))
    .withMoveTaskResponses(SOURCE_QUEUE_ARN, [{ Results: [] }]);
  const manager = new SqsDlqRedriveManager(client);

  const result = await manager.startRedrive({
    sourceQueue: SOURCE_QUEUE_NAME,
    destinationQueue: DESTINATION_QUEUE_NAME,
    maxMessagesPerSecond: 50,
  });

  assert.deepEqual(result, {
    sourceQueueIdentifier: SOURCE_QUEUE_NAME,
    sourceQueueUrl: SOURCE_QUEUE_URL,
    sourceQueueArn: SOURCE_QUEUE_ARN,
    destinationQueueIdentifier: DESTINATION_QUEUE_NAME,
    destinationQueueUrl: DESTINATION_QUEUE_URL,
    destinationQueueArn: DESTINATION_QUEUE_ARN,
    taskHandle: 'task-1',
  });
  assert.deepEqual(client.startMessageMoveTaskInputs, [
    { SourceArn: SOURCE_QUEUE_ARN, DestinationArn: DESTINATION_QUEUE_ARN, MaxNumberOfMessagesPerSecond: 50 },
  ]);
});

test('SqsDlqRedriveManager rejects a start when a RUNNING task already exists', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withMoveTaskResponses(SOURCE_QUEUE_ARN, [{ Results: [{ TaskHandle: 'task-9', Status: 'RUNNING' }] }]);
  const manager = new SqsDlqRedriveManager(client);

  await assert.rejects(
    () => manager.startRedrive({ sourceQueue: SOURCE_QUEUE_NAME }),
    /already has a RUNNING message move task/i,
  );
  assert.equal(client.startMessageMoveTaskInputs.length, 0);
});

test('SqsDlqRedriveManager rejects invalid maxMessagesPerSecond and same-queue destinations', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withMoveTaskResponses(SOURCE_QUEUE_ARN, [{ Results: [] }]);
  const manager = new SqsDlqRedriveManager(client);

  await assert.rejects(
    () => manager.startRedrive({ sourceQueue: SOURCE_QUEUE_NAME, maxMessagesPerSecond: 0 }),
    /must be an integer between 1 and 500/i,
  );
  await assert.rejects(
    () => manager.startRedrive({ sourceQueue: SOURCE_QUEUE_NAME, destinationQueue: SOURCE_QUEUE_URL }),
    /must not be the same queue/i,
  );
});

test('SqsDlqRedriveManager requires DLQ source queues when destination is omitted', async () => {
  const client = new FakeSqsQueueOperationsClient()
    .withQueue(SOURCE_QUEUE_NAME, SOURCE_QUEUE_URL, createDlqAttributes())
    .withMoveTaskResponses(SOURCE_QUEUE_ARN, [{ Results: [] }])
    .withDeadLetterSourceQueuePages(SOURCE_QUEUE_URL, [{ queueUrls: [] }]);
  const manager = new SqsDlqRedriveManager(client);

  await assert.rejects(
    () => manager.startRedrive({ sourceQueue: SOURCE_QUEUE_NAME }),
    /has no dead-letter source queues/i,
  );
  assert.equal(client.startMessageMoveTaskInputs.length, 0);
});

test('SqsDlqRedriveManager cancels a running native redrive task', async () => {
  const client = new FakeSqsQueueOperationsClient();
  const manager = new SqsDlqRedriveManager(client);

  const result = await manager.cancelRedrive({ taskHandle: 'task-12' });

  assert.deepEqual(result, { taskHandle: 'task-12', approximateNumberOfMessagesMoved: 7 });
  assert.deepEqual(client.cancelMessageMoveTaskInputs, [{ TaskHandle: 'task-12' }]);
});
