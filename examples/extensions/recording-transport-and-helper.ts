import type {
  ChangeMessageVisibilityBatchCommandInput,
  ChangeMessageVisibilityBatchCommandOutput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  GetQueueUrlCommandInput,
  GetQueueUrlCommandOutput,
  SendMessageBatchCommandInput,
  SendMessageBatchCommandOutput,
  SendMessageCommandInput,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  SqsPublisher,
  SqsQueueUrlResolver,
  type SqsTransportClient,
  sqsNumberAttribute,
  sqsStringAttribute,
} from '@idenstra/messaging-runtime';

type JobPayload = { jobId: string; taskType: string; payloadVersion: number };

class RecordingSqsTransportClient implements SqsTransportClient {
  readonly resolvedQueueNames: string[] = [];
  readonly sentBodies: string[] = [];

  constructor(private readonly inner: SqsTransportClient) {}

  async getQueueUrl(
    input: Pick<GetQueueUrlCommandInput, 'QueueName' | 'QueueOwnerAWSAccountId'>,
  ): Promise<Pick<GetQueueUrlCommandOutput, 'QueueUrl'>> {
    if (input.QueueName) {
      this.resolvedQueueNames.push(input.QueueName);
    }

    return this.inner.getQueueUrl(input);
  }

  async sendMessage(input: SendMessageCommandInput): Promise<SendMessageCommandOutput> {
    this.recordBody(input.MessageBody);
    return this.inner.sendMessage(input);
  }

  async sendMessageBatch(input: SendMessageBatchCommandInput): Promise<SendMessageBatchCommandOutput> {
    for (const entry of input.Entries ?? []) {
      this.recordBody(entry.MessageBody);
    }

    return this.inner.sendMessageBatch(input);
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    return this.inner.deleteMessageBatch(input);
  }

  async changeMessageVisibilityBatch(
    input: ChangeMessageVisibilityBatchCommandInput,
  ): Promise<ChangeMessageVisibilityBatchCommandOutput> {
    return this.inner.changeMessageVisibilityBatch(input);
  }

  private recordBody(body: string | undefined): void {
    if (typeof body === 'string') {
      this.sentBodies.push(body);
    }
  }
}

class JobPublisher {
  constructor(private readonly publisher: SqsPublisher) {}

  async publish(queue: string, payload: JobPayload) {
    return this.publisher.sendJson({
      queue,
      payload,
      messageAttributes: {
        taskType: sqsStringAttribute(payload.taskType),
        payloadVersion: sqsNumberAttribute(String(payload.payloadVersion)),
      },
    });
  }
}

const baseTransport = new AwsSqsAdapter(new SQSClient({ region: 'us-east-1' }));
const transport = new RecordingSqsTransportClient(baseTransport);
const queueResolver = new SqsQueueUrlResolver(transport, {
  preload: { jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
  allowNetworkLookup: false,
});
const publisher = new SqsPublisher(transport, queueResolver);
const jobPublisher = new JobPublisher(publisher);

void [transport, queueResolver, publisher, jobPublisher];
