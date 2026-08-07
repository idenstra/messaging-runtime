import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient } from '../../src';

export class FakeSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly deleteBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly messagesByQueue = new Map<
    string,
    Array<{ MessageId: string; ReceiptHandle: string; Body?: string }>
  >();

  withMessage(queueUrl: string, message: { MessageId: string; ReceiptHandle: string; Body?: string }): this {
    const queueMessages = this.messagesByQueue.get(queueUrl) ?? [];
    queueMessages.push(message);
    this.messagesByQueue.set(queueUrl, queueMessages);
    return this;
  }

  async receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
    this.receiveInputs.push(input);
    const queueUrl = input.QueueUrl ?? '';
    const queueMessages = this.messagesByQueue.get(queueUrl) ?? [];
    const maxMessages = input.MaxNumberOfMessages ?? 1;

    if (queueMessages.length === 0) {
      return { Messages: [] };
    }

    const messages = queueMessages.splice(0, maxMessages);
    return { Messages: messages };
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    this.deleteInputs.push(input);
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    this.deleteBatchInputs.push(input);
    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    this.visibilityInputs.push(input);
  }
}

export class FakeQueueResolver {
  readonly identifiers: string[] = [];

  constructor(private readonly bindings: Record<string, string>) {}

  async resolve(queue: string): Promise<string> {
    this.identifiers.push(queue);
    const queueUrl = this.bindings[queue];
    if (!queueUrl) {
      throw new Error(`No queue URL bound for ${queue}.`);
    }
    return queueUrl;
  }
}

export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
