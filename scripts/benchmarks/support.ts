import type {
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import type {
  SnsTransportClient,
  SqsRuntimeClient,
  SqsRuntimeRequestOptions,
  SqsTransportClient,
  SqsWorkerManager,
} from '../../src/index';

export interface BenchmarkScenario {
  name: string;
  description: string;
  iterationsPerSample: number;
  runIteration(): Promise<void>;
}

export interface BenchmarkScenarioResult {
  name: string;
  description: string;
  iterationsPerSample: number;
  sampleDurationsMs: number[];
  meanMsPerIteration: number;
  medianMsPerIteration: number;
  p95MsPerIteration: number;
  minMsPerIteration: number;
  maxMsPerIteration: number;
  opsPerSecond: number;
}

export interface BenchmarkReport {
  packageName: string;
  packageVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuModel?: string;
  command: string;
  warmupSamples: number;
  measuredSamples: number;
  scenarios: BenchmarkScenarioResult[];
}

export interface BenchmarkMessage {
  MessageId: string;
  ReceiptHandle: string;
  Body: string;
}

export const benchmarkRepresentativePayload = {
  jobId: 'job-42',
  attempt: 2,
  route: 'dispatch-email',
  tags: ['priority', 'notification'],
  metadata: { region: 'us-east-1', traceId: 'trace-123', correlationId: 'corr-456' },
} as const;

export const benchmarkSqsJsonBody = JSON.stringify(benchmarkRepresentativePayload);

export const benchmarkSnsNotificationEnvelopeBody = JSON.stringify({
  Type: 'Notification',
  MessageId: 'sns-message-1',
  TopicArn: 'arn:aws:sns:us-east-1:123456789012:dispatch-events',
  Subject: 'Dispatch event',
  Message: benchmarkSqsJsonBody,
  Timestamp: '2026-07-03T00:00:00.000Z',
  SignatureVersion: '1',
  Signature: 'signature',
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
  UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/unsubscribe',
});

export class BenchmarkSqsTransportClient implements SqsTransportClient {
  private readonly queueUrls = new Map<string, string>();

  withQueueUrl(queueName: string, queueUrl: string, ownerAccountId?: string): this {
    this.queueUrls.set(createQueueOwnerKey(queueName, ownerAccountId), queueUrl);
    if (ownerAccountId !== undefined) {
      this.queueUrls.set(createQueueOwnerKey(queueName), queueUrl);
    }
    return this;
  }

  async getQueueUrl(input: { QueueName?: string; QueueOwnerAWSAccountId?: string }) {
    if (!input.QueueName) {
      return { QueueUrl: undefined };
    }

    return {
      QueueUrl:
        this.queueUrls.get(createQueueOwnerKey(input.QueueName, input.QueueOwnerAWSAccountId)) ??
        this.queueUrls.get(createQueueOwnerKey(input.QueueName)),
    };
  }

  async sendMessage() {
    return { MessageId: 'message-1', SequenceNumber: '1' };
  }

  async sendMessageBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return {
      Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id, MessageId: `message-${entry.Id}` })),
      Failed: [],
    };
  }

  async deleteMessageBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return { Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id })), Failed: [] };
  }

  async changeMessageVisibilityBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return { Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id })), Failed: [] };
  }
}

export class BenchmarkSnsTransportClient implements SnsTransportClient {
  private readonly topicArns: string[] = [];

  withTopicArn(topicArn: string): this {
    this.topicArns.push(topicArn);
    return this;
  }

  async listTopics() {
    return { Topics: this.topicArns.map((TopicArn) => ({ TopicArn })) };
  }

  async publish() {
    return { MessageId: 'sns-message-1', SequenceNumber: '1' };
  }

  async publishBatch(input: { PublishBatchRequestEntries?: Array<{ Id?: string }> }) {
    return {
      Successful: (input.PublishBatchRequestEntries ?? []).map((entry) => ({
        Id: entry.Id,
        MessageId: `sns-message-${entry.Id}`,
        SequenceNumber: '1',
      })),
      Failed: [],
    };
  }
}

export class BenchmarkWorkerRuntimeClient implements SqsRuntimeClient {
  private readonly batches: Array<{ Messages?: BenchmarkMessage[] }>;
  readonly deleteBatchInputs: DeleteMessageBatchCommandInput[] = [];

  constructor(batches: Array<{ Messages?: BenchmarkMessage[] }>) {
    this.batches = batches.map((batch) => ({ Messages: batch.Messages?.map((message) => ({ ...message })) }));
  }

  async receiveMessage(
    input: ReceiveMessageCommandInput,
    _options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    const next = this.batches.shift();
    if (!next?.Messages?.length) {
      return { Messages: [] };
    }

    const maxMessages = input.MaxNumberOfMessages ?? next.Messages.length;
    const messages = next.Messages.slice(0, maxMessages);
    if (messages.length < next.Messages.length) {
      this.batches.unshift({ Messages: next.Messages.slice(maxMessages) });
    }

    return { Messages: messages };
  }

  async deleteMessage(): Promise<void> {}

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    this.deleteBatchInputs.push(input);
    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(): Promise<void> {}
}

export class BenchmarkMultiRouteWorkerRuntimeClient implements SqsRuntimeClient {
  private readonly batchesByQueueUrl: Map<string, Array<{ Messages?: BenchmarkMessage[] }>>;
  readonly receiveCountsByQueueUrl = new Map<string, number>();

  constructor(batchesByQueueUrl: Record<string, Array<{ Messages?: BenchmarkMessage[] }>>) {
    this.batchesByQueueUrl = new Map(
      Object.entries(batchesByQueueUrl).map(([queueUrl, batches]) => [
        queueUrl,
        batches.map((batch) => ({ Messages: batch.Messages?.map((message) => ({ ...message })) })),
      ]),
    );
  }

  async receiveMessage(
    input: ReceiveMessageCommandInput,
    _options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    const queueUrl = input.QueueUrl ?? 'unknown-queue';
    this.receiveCountsByQueueUrl.set(queueUrl, (this.receiveCountsByQueueUrl.get(queueUrl) ?? 0) + 1);

    const queueBatches = this.batchesByQueueUrl.get(queueUrl);
    const next = queueBatches?.shift();
    if (!next?.Messages?.length) {
      return { Messages: [] };
    }

    const maxMessages = input.MaxNumberOfMessages ?? next.Messages.length;
    const messages = next.Messages.slice(0, maxMessages);
    if (messages.length < next.Messages.length) {
      queueBatches?.unshift({ Messages: next.Messages.slice(maxMessages) });
    }

    return { Messages: messages };
  }

  async deleteMessage(): Promise<void> {}

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(): Promise<void> {}
}

export function createBenchmarkMessages(count: number, body = benchmarkSqsJsonBody): BenchmarkMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    MessageId: `message-${index + 1}`,
    ReceiptHandle: `receipt-${index + 1}`,
    Body: body,
  }));
}

export function createQueueUrl(name: string): string {
  return `https://queue.test/${name}`;
}

export async function onceAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Benchmark waitFor timed out after ${timeoutMs}ms.`);
}

export async function runManagedBenchmarkScenario(
  manager: SqsWorkerManager,
  run: () => Promise<void>,
  options: { beforeStop?: () => void | Promise<void> } = {},
): Promise<void> {
  try {
    await manager.start();
    await run();
  } finally {
    await options.beforeStop?.();
    await manager.stop();
  }
}

export function createDeferred<T>(): { promise: Promise<T>; resolve: (value?: T | PromiseLike<T>) => void } {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createQueueOwnerKey(queueName: string, ownerAccountId?: string): string {
  return ownerAccountId ? `${ownerAccountId}:${queueName}` : queueName;
}
