import {
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  type Message as SqsSdkMessage,
  type ReceiveMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';

export interface SqsWorkerLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SqsWorkerMessageAttributeValue {
  stringValue?: string;
  binaryValue?: Uint8Array;
  stringListValues?: string[];
  binaryListValues?: Uint8Array[];
  dataType?: string;
}

export interface SqsWorkerMessage {
  messageId: string;
  receiptHandle: string;
  body?: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, SqsWorkerMessageAttributeValue>;
  raw: SqsSdkMessage;
}

export interface SqsWorkerHandlerResult {
  action?: 'delete' | 'keep';
}

export interface SqsWorkerHandlerContext<TPayload> {
  routeName: string;
  queueUrl: string;
  payload: TPayload;
  message: SqsWorkerMessage;
  heartbeat(): Promise<void>;
}

export type SqsWorkerHandler<TPayload> = (
  context: SqsWorkerHandlerContext<TPayload>,
) => Promise<SqsWorkerHandlerResult | void>;

export interface SqsWorkerRouteConfig {
  concurrency: number;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  heartbeatIntervalMs: number;
  emptyReceiveDelayMs: number;
  errorBackoffMs: number;
  maxMessagesPerPoll: number;
}

export interface SqsWorkerRoute<TPayload> {
  name: string;
  queueUrl: string;
  decodePayload?: (message: SqsWorkerMessage) => TPayload;
  handle: SqsWorkerHandler<TPayload>;
  config?: Partial<SqsWorkerRouteConfig>;
}

export interface SqsWorkerManagerOptions {
  logger?: SqsWorkerLogger;
  defaults?: Partial<SqsWorkerRouteConfig>;
}

export interface SqsWorkerRouteStatus {
  name: string;
  queueUrl: string;
  running: boolean;
  stopping: boolean;
  inFlight: number;
  lastReceiveAt?: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
}

export interface SqsRuntimeClient {
  receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput>;
  deleteMessage(input: DeleteMessageCommandInput): Promise<void>;
  changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void>;
}

export class AwsSqsRuntimeClient implements SqsRuntimeClient {
  constructor(private readonly client: SQSClient) {}

  receiveMessage(input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> {
    return this.client.send(new ReceiveMessageCommand(input));
  }

  async deleteMessage(input: DeleteMessageCommandInput): Promise<void> {
    await this.client.send(new DeleteMessageCommand(input));
  }

  async changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void> {
    await this.client.send(new ChangeMessageVisibilityCommand(input));
  }
}

const DEFAULT_ROUTE_CONFIG: SqsWorkerRouteConfig = {
  concurrency: 4,
  waitTimeSeconds: 20,
  visibilityTimeoutSeconds: 60,
  heartbeatIntervalMs: 20_000,
  emptyReceiveDelayMs: 250,
  errorBackoffMs: 1_000,
  maxMessagesPerPoll: 10,
};

const DEFAULT_LOGGER: SqsWorkerLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface NormalizedRoute<TPayload> extends SqsWorkerRoute<TPayload> {
  config: SqsWorkerRouteConfig;
}

interface RouteRuntime<TPayload> {
  route: NormalizedRoute<TPayload>;
  status: SqsWorkerRouteStatus;
  loop?: Promise<void>;
  tasks: Set<Promise<void>>;
}

export class SqsWorkerManager {
  private readonly logger: SqsWorkerLogger;
  private readonly defaults: Partial<SqsWorkerRouteConfig>;
  private readonly routes = new Map<string, RouteRuntime<unknown>>();
  private started = false;
  private stopping = false;

  constructor(
    private readonly client: SqsRuntimeClient,
    options: SqsWorkerManagerOptions = {},
  ) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.defaults = options.defaults ?? {};
  }

  register<TPayload>(route: SqsWorkerRoute<TPayload>): void {
    if (this.started) {
      throw new Error('Cannot register new SQS worker routes after the manager has started.');
    }
    if (this.routes.has(route.name)) {
      throw new Error(`SQS worker route ${route.name} is already registered.`);
    }

    const normalized: NormalizedRoute<TPayload> = {
      ...route,
      decodePayload: route.decodePayload ?? defaultDecodePayload<TPayload>,
      config: {
        ...DEFAULT_ROUTE_CONFIG,
        ...this.defaults,
        ...route.config,
      },
    };

    this.routes.set(route.name, {
      route: normalized as NormalizedRoute<unknown>,
      status: {
        name: normalized.name,
        queueUrl: normalized.queueUrl,
        running: false,
        stopping: false,
        inFlight: 0,
      },
      tasks: new Set(),
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.stopping = false;

    for (const runtime of this.routes.values()) {
      runtime.status.running = true;
      runtime.status.stopping = false;
      runtime.loop = this.runRouteLoop(runtime);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.stopping = true;

    await Promise.all(
      [...this.routes.values()].map(async (runtime) => {
        runtime.status.stopping = true;
        runtime.status.running = false;
        await runtime.loop;
        await Promise.all([...runtime.tasks]);
      }),
    );

    this.started = false;
    this.stopping = false;
  }

  getStatus(): SqsWorkerRouteStatus[] {
    return [...this.routes.values()].map(({ status }) => ({ ...status }));
  }

  private async runRouteLoop(runtime: RouteRuntime<unknown>): Promise<void> {
    const { route, status } = runtime;

    while (!this.stopping) {
      const remainingCapacity = route.config.concurrency - status.inFlight;
      if (remainingCapacity <= 0) {
        await sleep(25);
        continue;
      }

      try {
        const response = await this.client.receiveMessage({
          QueueUrl: route.queueUrl,
          MaxNumberOfMessages: Math.max(
            1,
            Math.min(10, remainingCapacity, route.config.maxMessagesPerPoll),
          ),
          WaitTimeSeconds: route.config.waitTimeSeconds,
          VisibilityTimeout: route.config.visibilityTimeoutSeconds,
          AttributeNames: ['All'],
          MessageAttributeNames: ['All'],
        });

        const messages = (response.Messages ?? []).slice(0, remainingCapacity);
        if (messages.length === 0) {
          await sleep(route.config.emptyReceiveDelayMs);
          continue;
        }

        status.lastReceiveAt = new Date();
        for (const rawMessage of messages) {
          const task = this.processMessage(runtime, rawMessage)
            .catch((error: unknown) => {
              const detail = describeUnknownError(error);
              status.lastErrorAt = new Date();
              status.lastErrorMessage = detail;
              this.logger.error('SQS worker message processing failed.', {
                routeName: route.name,
                queueUrl: route.queueUrl,
                messageId: rawMessage.MessageId,
                error: detail,
              });
            })
            .finally(() => {
              status.inFlight -= 1;
              runtime.tasks.delete(task);
            });

          status.inFlight += 1;
          runtime.tasks.add(task);
        }
      } catch (error) {
        const detail = describeUnknownError(error);
        status.lastErrorAt = new Date();
        status.lastErrorMessage = detail;
        this.logger.error('SQS worker polling failed.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          error: detail,
        });
        await sleep(route.config.errorBackoffMs);
      }
    }
  }

  private async processMessage(runtime: RouteRuntime<unknown>, rawMessage: SqsSdkMessage): Promise<void> {
    const { route, status } = runtime;
    const message = toWorkerMessage(rawMessage);

    let heartbeatTimer: NodeJS.Timeout | undefined;
    try {
      const heartbeat = async (): Promise<void> => {
        await this.client.changeMessageVisibility({
          QueueUrl: route.queueUrl,
          ReceiptHandle: message.receiptHandle,
          VisibilityTimeout: route.config.visibilityTimeoutSeconds,
        });
      };

      if (route.config.heartbeatIntervalMs > 0) {
        heartbeatTimer = setInterval(() => {
          void heartbeat().catch((error: unknown) => {
            this.logger.warn('SQS worker heartbeat failed.', {
              routeName: route.name,
              queueUrl: route.queueUrl,
              messageId: message.messageId,
              error: describeUnknownError(error),
            });
          });
        }, route.config.heartbeatIntervalMs);
      }

      const payload = route.decodePayload?.(message);
      const result = await route.handle({
        routeName: route.name,
        queueUrl: route.queueUrl,
        payload,
        message,
        heartbeat,
      });

      if ((result?.action ?? 'delete') === 'delete') {
        await this.client.deleteMessage({
          QueueUrl: route.queueUrl,
          ReceiptHandle: message.receiptHandle,
        });
      }

      status.lastSuccessAt = new Date();
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }
}

function toWorkerMessage(message: SqsSdkMessage): SqsWorkerMessage {
  if (!message.MessageId || !message.ReceiptHandle) {
    throw new Error('SQS message is missing MessageId or ReceiptHandle.');
  }

  return {
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    body: message.Body,
    attributes: message.Attributes ?? {},
    messageAttributes:
      Object.fromEntries(
        Object.entries(message.MessageAttributes ?? {}).map(([key, value]) => [
          key,
          {
            stringValue: value.StringValue,
            binaryValue: value.BinaryValue,
            stringListValues: value.StringListValues,
            binaryListValues: value.BinaryListValues,
            dataType: value.DataType,
          },
        ]),
      ) ?? {},
    raw: message,
  };
}

function defaultDecodePayload<TPayload>(message: SqsWorkerMessage): TPayload {
  if (!message.body) {
    return undefined as TPayload;
  }

  return JSON.parse(message.body) as TPayload;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
