import type {
  ChangeMessageVisibilityCommandInput,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  DeleteMessageCommandInput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import type { SqsRuntimeClient, SqsRuntimeRequestOptions } from '../../src';

export type ReceiveBatch =
  | ReceiveMessageCommandOutput
  | ((input: ReceiveMessageCommandInput, options?: SqsRuntimeRequestOptions) => Promise<ReceiveMessageCommandOutput>);

export class FakeSqsClient implements SqsRuntimeClient {
  readonly receiveInputs: ReceiveMessageCommandInput[] = [];
  readonly deleteInputs: DeleteMessageCommandInput[] = [];
  readonly deleteBatchInputs: DeleteMessageBatchCommandInput[] = [];
  readonly visibilityInputs: ChangeMessageVisibilityCommandInput[] = [];
  private readonly batches: ReceiveBatch[];
  deleteImpl?: (input: DeleteMessageCommandInput) => Promise<void>;
  deleteBatchImpl?: (input: DeleteMessageBatchCommandInput) => Promise<DeleteMessageBatchCommandOutput>;
  visibilityImpl?: (input: ChangeMessageVisibilityCommandInput) => Promise<void>;

  constructor(batches: ReceiveBatch[]) {
    this.batches = [...batches];
  }

  async receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    this.receiveInputs.push(input);

    const next = this.batches.shift();
    if (!next) {
      return { Messages: [] };
    }

    if (typeof next === 'function') {
      return next(input, options);
    }

    const maxMessages = input.MaxNumberOfMessages ?? 1;
    const messages = next.Messages ?? [];
    if (messages.length <= maxMessages) {
      return next;
    }

    this.batches.unshift({ ...next, Messages: messages.slice(maxMessages) });

    return { ...next, Messages: messages.slice(0, maxMessages) };
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    this.deleteInputs.push(input);
    await this.deleteImpl?.(input);
  }

  async deleteMessageBatch(input: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> {
    this.deleteBatchInputs.push(input);
    if (this.deleteBatchImpl) {
      return this.deleteBatchImpl(input);
    }

    return { Successful: (input.Entries ?? []).flatMap((entry) => (entry.Id ? [{ Id: entry.Id }] : [])), Failed: [] };
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    this.visibilityInputs.push(input);
    await this.visibilityImpl?.(input);
  }
}

export async function onceAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
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

export function createDeferred<T>(): { promise: Promise<T>; resolve: (value?: T | PromiseLike<T>) => void } {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}
