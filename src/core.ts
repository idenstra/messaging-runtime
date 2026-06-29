import {
  ChangeMessageVisibilityCommand,
  type ChangeMessageVisibilityCommandInput,
  DeleteMessageCommand,
  type DeleteMessageCommandInput,
  ReceiveMessageCommand,
  type ReceiveMessageCommandInput,
  type ReceiveMessageCommandOutput,
  SQSClient,
  type Message as SqsSdkMessage,
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

export type SqsWorkerAckAction = 'delete' | 'keep';
export type SqsWorkerFailureKind = 'decode' | 'handler' | 'timeout';
export type SqsWorkerTimeoutStrategy = 'cooperative' | 'abandon';
export type SqsWorkerHeartbeatSource = 'interval' | 'manual';
export type SqsWorkerLateSettlementOutcome = 'resolved' | 'rejected';

export interface SqsWorkerHandlerResult {
  action?: SqsWorkerAckAction;
}

export interface SqsWorkerHandlerContext<TPayload> {
  routeName: string;
  queueUrl: string;
  payload: TPayload;
  message: SqsWorkerMessage;
  abortSignal: AbortSignal;
  heartbeat(): Promise<void>;
}

export type SqsWorkerHandler<TPayload> = (
  context: SqsWorkerHandlerContext<TPayload>,
) => Promise<SqsWorkerHandlerResult | undefined>;

export interface SqsWorkerErrorContext<TPayload> {
  routeName: string;
  queueUrl: string;
  message: SqsWorkerMessage;
  payload?: TPayload;
  abortSignal: AbortSignal;
  failureKind: SqsWorkerFailureKind;
  error: unknown;
  durationMs: number;
  timeoutStrategy?: SqsWorkerTimeoutStrategy;
  settlementOutcome?: SqsWorkerLateSettlementOutcome | 'pending';
  settlementError?: unknown;
}

export type SqsWorkerErrorHook<TPayload> = (
  context: SqsWorkerErrorContext<TPayload>,
) => SqsWorkerAckAction | undefined | Promise<SqsWorkerAckAction | undefined>;

export interface SqsWorkerRouteConfig {
  concurrency: number;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  heartbeatIntervalMs: number;
  emptyReceiveDelayMs: number;
  errorBackoffMs: number;
  maxMessagesPerPoll: number;
  handlerTimeoutMs?: number;
  timeoutStrategy: SqsWorkerTimeoutStrategy;
  failureAction: SqsWorkerAckAction;
}

export interface SqsWorkerRoute<TPayload> {
  name: string;
  queueUrl: string;
  decodePayload?: (message: SqsWorkerMessage) => TPayload;
  handle: SqsWorkerHandler<TPayload>;
  onError?: SqsWorkerErrorHook<TPayload>;
  config?: Partial<SqsWorkerRouteConfig>;
}

export interface SqsWorkerManagerOptions {
  logger?: SqsWorkerLogger;
  defaults?: Partial<SqsWorkerRouteConfig>;
  onEvent?: SqsWorkerRuntimeEventHook;
}

export interface SqsWorkerRouteCounters {
  receiveEmptyCount: number;
  messagesReceivedCount: number;
  handlerStartedCount: number;
  handlerSuccessCount: number;
  handlerFailureCount: number;
  handlerTimeoutCount: number;
  lateSettlementCount: number;
  messageDeleteCount: number;
  messageKeepCount: number;
  heartbeatSuccessCount: number;
  heartbeatFailureCount: number;
}

export interface SqsWorkerRouteStatus {
  name: string;
  queueUrl: string;
  running: boolean;
  stopping: boolean;
  inFlight: number;
  counters: SqsWorkerRouteCounters;
  lastReceiveAt?: Date;
  lastReceiveEmptyAt?: Date;
  lastStartedAt?: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  lastFailureKind?: SqsWorkerFailureKind;
  lastTimeoutAt?: Date;
  lastDeleteAt?: Date;
  lastKeepAt?: Date;
  lastHeartbeatSuccessAt?: Date;
  lastHeartbeatFailureAt?: Date;
  lastHeartbeatFailureMessage?: string;
  lastLateSettlementAt?: Date;
  lastLateSettlementOutcome?: SqsWorkerLateSettlementOutcome;
}

export interface SqsWorkerManagerSnapshot {
  started: boolean;
  stopping: boolean;
  routeCount: number;
  totalInFlight: number;
  counters: SqsWorkerRouteCounters;
  routes: SqsWorkerRouteStatus[];
}

interface SqsWorkerRuntimeEventBase {
  type: string;
  at: Date;
  routeName: string;
  queueUrl: string;
}

export interface SqsWorkerReceiveEmptyEvent extends SqsWorkerRuntimeEventBase {
  type: 'receive-empty';
}

export interface SqsWorkerMessagesReceivedEvent extends SqsWorkerRuntimeEventBase {
  type: 'messages-received';
  messageCount: number;
}

export interface SqsWorkerHandlerStartEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-start';
  messageId: string;
}

export interface SqsWorkerHandlerSuccessEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-success';
  messageId: string;
  durationMs: number;
}

export interface SqsWorkerHandlerFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-failure';
  messageId: string;
  failureKind: Exclude<SqsWorkerFailureKind, 'timeout'>;
  durationMs: number;
  action: SqsWorkerAckAction;
  error: unknown;
}

export interface SqsWorkerHandlerTimeoutEvent extends SqsWorkerRuntimeEventBase {
  type: 'handler-timeout';
  messageId: string;
  durationMs: number;
  timeoutStrategy: SqsWorkerTimeoutStrategy;
  settlementOutcome: SqsWorkerLateSettlementOutcome | 'pending';
  error: unknown;
}

export interface SqsWorkerLateSettlementEvent extends SqsWorkerRuntimeEventBase {
  type: 'late-settlement';
  messageId: string;
  durationMs: number;
  outcome: SqsWorkerLateSettlementOutcome;
  error?: unknown;
}

export interface SqsWorkerMessageDeleteEvent extends SqsWorkerRuntimeEventBase {
  type: 'message-delete';
  messageId: string;
  reason: 'success' | 'failure' | 'timeout';
}

export interface SqsWorkerMessageKeepEvent extends SqsWorkerRuntimeEventBase {
  type: 'message-keep';
  messageId: string;
  reason: 'success' | 'failure' | 'timeout';
}

export interface SqsWorkerHeartbeatSuccessEvent extends SqsWorkerRuntimeEventBase {
  type: 'heartbeat-success';
  messageId: string;
  source: SqsWorkerHeartbeatSource;
}

export interface SqsWorkerHeartbeatFailureEvent extends SqsWorkerRuntimeEventBase {
  type: 'heartbeat-failure';
  messageId: string;
  source: SqsWorkerHeartbeatSource;
  error: unknown;
}

export type SqsWorkerRuntimeEvent =
  | SqsWorkerReceiveEmptyEvent
  | SqsWorkerMessagesReceivedEvent
  | SqsWorkerHandlerStartEvent
  | SqsWorkerHandlerSuccessEvent
  | SqsWorkerHandlerFailureEvent
  | SqsWorkerHandlerTimeoutEvent
  | SqsWorkerLateSettlementEvent
  | SqsWorkerMessageDeleteEvent
  | SqsWorkerMessageKeepEvent
  | SqsWorkerHeartbeatSuccessEvent
  | SqsWorkerHeartbeatFailureEvent;

export type SqsWorkerRuntimeEventHook = (event: SqsWorkerRuntimeEvent) => void;

export interface SqsRuntimeClient {
  receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput>;
  deleteMessage(input: DeleteMessageCommandInput): Promise<void>;
  changeMessageVisibility(input: ChangeMessageVisibilityCommandInput): Promise<void>;
}

export interface SqsRuntimeRequestOptions {
  abortSignal?: AbortSignal;
}

export class SqsWorkerTimeoutError extends Error {
  readonly routeName: string;
  readonly messageId: string;
  readonly timeoutMs: number;
  readonly timeoutStrategy: SqsWorkerTimeoutStrategy;

  constructor(options: {
    routeName: string;
    messageId: string;
    timeoutMs: number;
    timeoutStrategy: SqsWorkerTimeoutStrategy;
  }) {
    super(`SQS worker handler timed out after ${options.timeoutMs}ms on route ${options.routeName}.`);
    this.name = 'SqsWorkerTimeoutError';
    this.routeName = options.routeName;
    this.messageId = options.messageId;
    this.timeoutMs = options.timeoutMs;
    this.timeoutStrategy = options.timeoutStrategy;
  }
}

export class AwsSqsRuntimeClient implements SqsRuntimeClient {
  constructor(private readonly client: SQSClient) {}

  receiveMessage(
    input: ReceiveMessageCommandInput,
    options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    return this.client.send(new ReceiveMessageCommand(input), options);
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
  timeoutStrategy: 'cooperative',
  failureAction: 'keep',
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
  pollAbortController?: AbortController;
}

type SettledHandlerResult =
  | { outcome: 'resolved'; result: SqsWorkerHandlerResult | undefined }
  | { outcome: 'rejected'; error: unknown };

export class SqsWorkerManager {
  private readonly logger: SqsWorkerLogger;
  private readonly defaults: Partial<SqsWorkerRouteConfig>;
  private readonly onEvent?: SqsWorkerRuntimeEventHook;
  private readonly routes = new Map<string, RouteRuntime<unknown>>();
  private started = false;
  private stopping = false;

  constructor(
    private readonly client: SqsRuntimeClient,
    options: SqsWorkerManagerOptions = {},
  ) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.defaults = options.defaults ?? {};
    this.onEvent = options.onEvent;
  }

  register<TPayload>(route: SqsWorkerRoute<TPayload>): void {
    if (this.started) {
      throw new Error('Cannot register new SQS worker routes after the manager has started.');
    }
    if (this.routes.has(route.name)) {
      throw new Error(`SQS worker route ${route.name} is already registered.`);
    }
    if (route.onError !== undefined && typeof route.onError !== 'function') {
      throw new Error(`SQS worker route ${route.name} has invalid onError; expected a function.`);
    }

    const normalized: NormalizedRoute<TPayload> = {
      ...route,
      decodePayload: route.decodePayload ?? defaultDecodePayload<TPayload>,
      config: { ...DEFAULT_ROUTE_CONFIG, ...this.defaults, ...route.config },
    };
    validateRoute(route.name, route.queueUrl, normalized.config);

    this.routes.set(route.name, {
      route: normalized as NormalizedRoute<unknown>,
      status: {
        name: normalized.name,
        queueUrl: normalized.queueUrl,
        running: false,
        stopping: false,
        inFlight: 0,
        counters: createCounters(),
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
        runtime.pollAbortController?.abort();
        await runtime.loop;
        await Promise.all([...runtime.tasks]);
      }),
    );

    this.started = false;
    this.stopping = false;
  }

  getStatus(): SqsWorkerRouteStatus[] {
    return [...this.routes.values()].map(({ status }) => cloneRouteStatus(status));
  }

  getSnapshot(): SqsWorkerManagerSnapshot {
    const routes = this.getStatus();

    return {
      started: this.started,
      stopping: this.stopping,
      routeCount: routes.length,
      totalInFlight: routes.reduce((total, route) => total + route.inFlight, 0),
      counters: routes.reduce((aggregate, route) => addCounters(aggregate, route.counters), createCounters()),
      routes,
    };
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
        const abortController = new AbortController();
        runtime.pollAbortController = abortController;
        const response = await this.client.receiveMessage(
          {
            QueueUrl: route.queueUrl,
            MaxNumberOfMessages: Math.max(1, Math.min(10, remainingCapacity, route.config.maxMessagesPerPoll)),
            WaitTimeSeconds: route.config.waitTimeSeconds,
            VisibilityTimeout: route.config.visibilityTimeoutSeconds,
            AttributeNames: ['All'],
            MessageAttributeNames: ['All'],
          },
          { abortSignal: abortController.signal },
        );
        if (runtime.pollAbortController === abortController) {
          runtime.pollAbortController = undefined;
        }

        const messages = (response.Messages ?? []).slice(0, remainingCapacity);
        if (messages.length === 0) {
          this.emitRuntimeEvent(status, {
            type: 'receive-empty',
            at: new Date(),
            routeName: route.name,
            queueUrl: route.queueUrl,
          });
          await sleep(route.config.emptyReceiveDelayMs);
          continue;
        }

        this.emitRuntimeEvent(status, {
          type: 'messages-received',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageCount: messages.length,
        });

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
        runtime.pollAbortController = undefined;
        if (this.stopping && isAbortError(error)) {
          break;
        }
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
    const startedAtMs = Date.now();
    const abortController = new AbortController();
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatEnabled = true;
    let heartbeatRunning = false;
    let timeoutObserved = false;

    const emitHeartbeatSuccess = (source: SqsWorkerHeartbeatSource): void => {
      this.emitRuntimeEvent(status, {
        type: 'heartbeat-success',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
        source,
      });
    };

    const emitHeartbeatFailure = (source: SqsWorkerHeartbeatSource, error: unknown): void => {
      this.emitRuntimeEvent(status, {
        type: 'heartbeat-failure',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
        source,
        error,
      });
    };

    const heartbeat = async (source: SqsWorkerHeartbeatSource = 'manual'): Promise<void> => {
      if (!heartbeatEnabled) {
        const error = new Error('SQS worker heartbeat is no longer available for this message.');
        emitHeartbeatFailure(source, error);
        throw error;
      }

      try {
        await this.client.changeMessageVisibility({
          QueueUrl: route.queueUrl,
          ReceiptHandle: message.receiptHandle,
          VisibilityTimeout: route.config.visibilityTimeoutSeconds,
        });
        emitHeartbeatSuccess(source);
      } catch (error: unknown) {
        emitHeartbeatFailure(source, error);
        throw error;
      }
    };

    const disableHeartbeat = (): void => {
      heartbeatEnabled = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const runHeartbeat = async (): Promise<void> => {
      if (!heartbeatEnabled || heartbeatRunning) {
        return;
      }

      heartbeatRunning = true;
      try {
        await heartbeat('interval');
      } catch (error: unknown) {
        this.logger.warn('SQS worker heartbeat failed.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageId: message.messageId,
          error: describeUnknownError(error),
        });
      } finally {
        heartbeatRunning = false;
      }
    };

    if (route.config.heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(() => {
        void runHeartbeat();
      }, route.config.heartbeatIntervalMs);
    }

    try {
      const payload = route.decodePayload?.(message);
      this.emitRuntimeEvent(status, {
        type: 'handler-start',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
      });
      const handlerPromise = Promise.resolve().then(() =>
        route.handle({
          routeName: route.name,
          queueUrl: route.queueUrl,
          payload,
          message,
          abortSignal: abortController.signal,
          heartbeat: () => heartbeat('manual'),
        }),
      );

      if (route.config.handlerTimeoutMs === undefined) {
        await this.handleWithoutTimeout(
          status,
          route,
          message,
          payload,
          handlerPromise,
          startedAtMs,
          abortController.signal,
        );
        return;
      }

      const timedOutcome = await this.awaitWithTimeout(handlerPromise, route, message, status, abortController, () => {
        timeoutObserved = true;
      });

      if (timedOutcome.type === 'resolved') {
        await this.finishSuccess(status, route, message, timedOutcome.result, startedAtMs);
        return;
      }

      if (timedOutcome.type === 'rejected') {
        await this.finishFailure({
          status,
          route,
          message,
          payload,
          abortSignal: abortController.signal,
          failureKind: 'handler',
          error: timedOutcome.error,
          durationMs: Date.now() - startedAtMs,
          allowDelete: true,
        });
        return;
      }

      const timeoutError = timedOutcome.error;
      this.emitRuntimeEvent(status, {
        type: 'handler-timeout',
        at: timedOutcome.timedOutAt,
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
        durationMs: Date.now() - startedAtMs,
        timeoutStrategy: route.config.timeoutStrategy,
        settlementOutcome: 'pending',
        error: timeoutError,
      });

      if (route.config.timeoutStrategy === 'abandon') {
        disableHeartbeat();
        await this.finishFailure({
          status,
          route,
          message,
          payload,
          abortSignal: abortController.signal,
          failureKind: 'timeout',
          error: timeoutError,
          durationMs: Date.now() - startedAtMs,
          allowDelete: false,
          timeoutStrategy: 'abandon',
          settlementOutcome: 'pending',
        });

        void this.observeLateSettlement(status, route, message, handlerPromise, startedAtMs);
        return;
      }

      const settlement = await settleHandler(handlerPromise);
      const settlementOutcome: SqsWorkerLateSettlementOutcome = settlement.outcome;
      await this.finishFailure({
        status,
        route,
        message,
        payload,
        abortSignal: abortController.signal,
        failureKind: 'timeout',
        error: timeoutError,
        durationMs: Date.now() - startedAtMs,
        allowDelete: true,
        timeoutStrategy: 'cooperative',
        settlementOutcome,
        settlementError: settlement.outcome === 'rejected' ? settlement.error : undefined,
      });
    } catch (error: unknown) {
      await this.finishFailure({
        status,
        route,
        message,
        payload: undefined,
        abortSignal: abortController.signal,
        failureKind: 'decode',
        error,
        durationMs: Date.now() - startedAtMs,
        allowDelete: true,
      });
    } finally {
      if (!timeoutObserved || route.config.timeoutStrategy === 'cooperative') {
        disableHeartbeat();
      }
    }
  }

  private async handleWithoutTimeout<TPayload>(
    status: SqsWorkerRouteStatus,
    route: NormalizedRoute<TPayload>,
    message: SqsWorkerMessage,
    payload: TPayload,
    handlerPromise: Promise<SqsWorkerHandlerResult | undefined>,
    startedAtMs: number,
    abortSignal: AbortSignal,
  ): Promise<void> {
    try {
      const result = await handlerPromise;
      await this.finishSuccess(status, route, message, result, startedAtMs);
    } catch (error: unknown) {
      await this.finishFailure({
        status,
        route,
        message,
        payload,
        abortSignal,
        failureKind: 'handler',
        error,
        durationMs: Date.now() - startedAtMs,
        allowDelete: true,
      });
    }
  }

  private async awaitWithTimeout<TPayload>(
    handlerPromise: Promise<SqsWorkerHandlerResult | undefined>,
    route: NormalizedRoute<TPayload>,
    message: SqsWorkerMessage,
    status: SqsWorkerRouteStatus,
    abortController: AbortController,
    onTimeoutObserved: () => void,
  ): Promise<
    | { type: 'resolved'; result: SqsWorkerHandlerResult | undefined }
    | { type: 'rejected'; error: unknown }
    | { type: 'timeout'; error: SqsWorkerTimeoutError; timedOutAt: Date }
  > {
    const timeoutMs = route.config.handlerTimeoutMs;
    if (timeoutMs === undefined) {
      throw new Error('handlerTimeoutMs must be defined when awaiting with timeout.');
    }

    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        handlerPromise.then(
          (result) => ({ type: 'resolved' as const, result }),
          (error) => ({ type: 'rejected' as const, error }),
        ),
        new Promise<{ type: 'timeout'; error: SqsWorkerTimeoutError; timedOutAt: Date }>((resolve) => {
          timeoutHandle = setTimeout(() => {
            onTimeoutObserved();
            const timedOutAt = new Date();
            const timeoutError = new SqsWorkerTimeoutError({
              routeName: route.name,
              messageId: message.messageId,
              timeoutMs,
              timeoutStrategy: route.config.timeoutStrategy,
            });
            recordFailure(status, 'timeout', timeoutError, timedOutAt);
            abortController.abort(timeoutError);
            resolve({ type: 'timeout', error: timeoutError, timedOutAt });
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimer(timeoutHandle);
    }
  }

  private async finishSuccess<TPayload>(
    status: SqsWorkerRouteStatus,
    route: NormalizedRoute<TPayload>,
    message: SqsWorkerMessage,
    result: SqsWorkerHandlerResult | undefined,
    startedAtMs: number,
  ): Promise<void> {
    const action = result?.action ?? 'delete';

    this.emitRuntimeEvent(status, {
      type: 'handler-success',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      durationMs: Date.now() - startedAtMs,
    });

    await this.applyAction(status, route, message, action, 'success');
  }

  private async finishFailure<TPayload>(params: {
    status: SqsWorkerRouteStatus;
    route: NormalizedRoute<TPayload>;
    message: SqsWorkerMessage;
    payload?: TPayload;
    abortSignal: AbortSignal;
    failureKind: SqsWorkerFailureKind;
    error: unknown;
    durationMs: number;
    allowDelete: boolean;
    timeoutStrategy?: SqsWorkerTimeoutStrategy;
    settlementOutcome?: SqsWorkerLateSettlementOutcome | 'pending';
    settlementError?: unknown;
  }): Promise<void> {
    const {
      status,
      route,
      message,
      payload,
      abortSignal,
      failureKind,
      error,
      durationMs,
      allowDelete,
      timeoutStrategy,
      settlementOutcome,
      settlementError,
    } = params;

    recordFailure(status, failureKind, error, new Date());
    const action = await this.resolveFailureAction(
      route,
      {
        routeName: route.name,
        queueUrl: route.queueUrl,
        message,
        payload,
        abortSignal,
        failureKind,
        error,
        durationMs,
        timeoutStrategy,
        settlementOutcome,
        settlementError,
      },
      allowDelete,
    );

    if (failureKind === 'timeout') {
      // The timeout occurrence itself was already emitted when the timeout fired.
      await this.applyAction(status, route, message, action, 'timeout');
      return;
    }

    this.emitRuntimeEvent(status, {
      type: 'handler-failure',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      failureKind,
      durationMs,
      action,
      error,
    });

    await this.applyAction(status, route, message, action, 'failure');
  }

  private async resolveFailureAction<TPayload>(
    route: NormalizedRoute<TPayload>,
    context: SqsWorkerErrorContext<TPayload>,
    allowDelete: boolean,
  ): Promise<SqsWorkerAckAction> {
    let action = route.config.failureAction;

    if (route.onError) {
      try {
        const override = await route.onError(context);
        if (override === 'delete' || override === 'keep') {
          action = override;
        } else if (override !== undefined) {
          this.logger.warn('SQS worker error hook returned an invalid action.', {
            routeName: route.name,
            queueUrl: route.queueUrl,
            returned: String(override),
          });
        }
      } catch (hookError: unknown) {
        this.logger.warn('SQS worker error hook failed; using route default failure action.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          error: describeUnknownError(hookError),
        });
      }
    }

    if (!allowDelete) {
      return 'keep';
    }

    return action;
  }

  private async applyAction<TPayload>(
    status: SqsWorkerRouteStatus,
    route: NormalizedRoute<TPayload>,
    message: SqsWorkerMessage,
    action: SqsWorkerAckAction,
    reason: 'success' | 'failure' | 'timeout',
  ): Promise<void> {
    if (action === 'delete') {
      await this.client.deleteMessage({ QueueUrl: route.queueUrl, ReceiptHandle: message.receiptHandle });
      this.emitRuntimeEvent(status, {
        type: 'message-delete',
        at: new Date(),
        routeName: route.name,
        queueUrl: route.queueUrl,
        messageId: message.messageId,
        reason,
      });
      return;
    }

    this.emitRuntimeEvent(status, {
      type: 'message-keep',
      at: new Date(),
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      reason,
    });
  }

  private async observeLateSettlement<TPayload>(
    status: SqsWorkerRouteStatus,
    route: NormalizedRoute<TPayload>,
    message: SqsWorkerMessage,
    handlerPromise: Promise<SqsWorkerHandlerResult | undefined>,
    startedAtMs: number,
  ): Promise<void> {
    const settled = await settleHandler(handlerPromise);
    const event =
      settled.outcome === 'resolved'
        ? {
            type: 'late-settlement' as const,
            at: new Date(),
            routeName: route.name,
            queueUrl: route.queueUrl,
            messageId: message.messageId,
            durationMs: Date.now() - startedAtMs,
            outcome: 'resolved' as const,
          }
        : {
            type: 'late-settlement' as const,
            at: new Date(),
            routeName: route.name,
            queueUrl: route.queueUrl,
            messageId: message.messageId,
            durationMs: Date.now() - startedAtMs,
            outcome: 'rejected' as const,
            error: settled.error,
          };

    this.emitRuntimeEvent(status, event);
    this.logger.warn('SQS worker handler settled after abandon timeout finalization.', {
      routeName: route.name,
      queueUrl: route.queueUrl,
      messageId: message.messageId,
      outcome: event.outcome,
      error: event.outcome === 'rejected' && event.error ? describeUnknownError(event.error) : undefined,
    });
  }

  private emitRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void {
    recordEvent(status, event);

    if (!this.onEvent) {
      return;
    }

    try {
      this.onEvent(event);
    } catch (error: unknown) {
      this.logger.warn('SQS worker runtime event hook failed.', {
        routeName: event.routeName,
        queueUrl: event.queueUrl,
        eventType: event.type,
        error: describeUnknownError(error),
      });
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
    messageAttributes: Object.fromEntries(
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
    ),
    raw: message,
  };
}

function defaultDecodePayload<TPayload>(message: SqsWorkerMessage): TPayload {
  if (message.body === undefined) {
    throw new Error('SQS message is missing a body.');
  }

  return JSON.parse(message.body) as TPayload;
}

function validateRoute(routeName: string, queueUrl: string, config: SqsWorkerRouteConfig): void {
  if (!routeName.trim()) {
    throw new Error('SQS worker route name must be a non-empty string.');
  }
  if (!queueUrl.trim()) {
    throw new Error(`SQS worker route ${routeName} must declare a non-empty queueUrl.`);
  }

  validateInteger(routeName, 'concurrency', config.concurrency, 1);
  validateInteger(routeName, 'waitTimeSeconds', config.waitTimeSeconds, 0, 20);
  validateInteger(routeName, 'visibilityTimeoutSeconds', config.visibilityTimeoutSeconds, 0, 43_200);
  validateInteger(routeName, 'heartbeatIntervalMs', config.heartbeatIntervalMs, 0);
  validateInteger(routeName, 'emptyReceiveDelayMs', config.emptyReceiveDelayMs, 0);
  validateInteger(routeName, 'errorBackoffMs', config.errorBackoffMs, 0);
  validateInteger(routeName, 'maxMessagesPerPoll', config.maxMessagesPerPoll, 1, 10);

  if (
    config.handlerTimeoutMs !== undefined &&
    (!Number.isInteger(config.handlerTimeoutMs) || config.handlerTimeoutMs < 1)
  ) {
    throw new Error(`SQS worker route ${routeName} has invalid handlerTimeoutMs; expected an integer >= 1.`);
  }

  if (config.timeoutStrategy !== 'cooperative' && config.timeoutStrategy !== 'abandon') {
    throw new Error(`SQS worker route ${routeName} has invalid timeoutStrategy; expected cooperative or abandon.`);
  }

  if (config.failureAction !== 'delete' && config.failureAction !== 'keep') {
    throw new Error(`SQS worker route ${routeName} has invalid failureAction; expected delete or keep.`);
  }
}

function validateInteger(
  routeName: string,
  field: keyof SqsWorkerRouteConfig,
  value: number,
  min: number,
  max?: number,
): void {
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const rangeDescription = max === undefined ? `>= ${min}` : `between ${min} and ${max}`;
    throw new Error(`SQS worker route ${routeName} has invalid ${field}; expected an integer ${rangeDescription}.`);
  }
}

function createCounters(): SqsWorkerRouteCounters {
  return {
    receiveEmptyCount: 0,
    messagesReceivedCount: 0,
    handlerStartedCount: 0,
    handlerSuccessCount: 0,
    handlerFailureCount: 0,
    handlerTimeoutCount: 0,
    lateSettlementCount: 0,
    messageDeleteCount: 0,
    messageKeepCount: 0,
    heartbeatSuccessCount: 0,
    heartbeatFailureCount: 0,
  };
}

function addCounters(target: SqsWorkerRouteCounters, source: SqsWorkerRouteCounters): SqsWorkerRouteCounters {
  return {
    receiveEmptyCount: target.receiveEmptyCount + source.receiveEmptyCount,
    messagesReceivedCount: target.messagesReceivedCount + source.messagesReceivedCount,
    handlerStartedCount: target.handlerStartedCount + source.handlerStartedCount,
    handlerSuccessCount: target.handlerSuccessCount + source.handlerSuccessCount,
    handlerFailureCount: target.handlerFailureCount + source.handlerFailureCount,
    handlerTimeoutCount: target.handlerTimeoutCount + source.handlerTimeoutCount,
    lateSettlementCount: target.lateSettlementCount + source.lateSettlementCount,
    messageDeleteCount: target.messageDeleteCount + source.messageDeleteCount,
    messageKeepCount: target.messageKeepCount + source.messageKeepCount,
    heartbeatSuccessCount: target.heartbeatSuccessCount + source.heartbeatSuccessCount,
    heartbeatFailureCount: target.heartbeatFailureCount + source.heartbeatFailureCount,
  };
}

function cloneRouteStatus(status: SqsWorkerRouteStatus): SqsWorkerRouteStatus {
  return { ...status, counters: { ...status.counters } };
}

function recordFailure(status: SqsWorkerRouteStatus, kind: SqsWorkerFailureKind, error: unknown, at: Date): void {
  status.lastErrorAt = at;
  status.lastErrorMessage = describeUnknownError(error);
  status.lastFailureKind = kind;
}

function recordEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void {
  switch (event.type) {
    case 'receive-empty':
      status.counters.receiveEmptyCount += 1;
      status.lastReceiveEmptyAt = event.at;
      return;
    case 'messages-received':
      status.counters.messagesReceivedCount += event.messageCount;
      status.lastReceiveAt = event.at;
      return;
    case 'handler-start':
      status.counters.handlerStartedCount += 1;
      status.lastStartedAt = event.at;
      return;
    case 'handler-success':
      status.counters.handlerSuccessCount += 1;
      status.lastSuccessAt = event.at;
      return;
    case 'handler-failure':
      status.counters.handlerFailureCount += 1;
      return;
    case 'handler-timeout':
      status.counters.handlerTimeoutCount += 1;
      status.lastTimeoutAt = event.at;
      return;
    case 'late-settlement':
      status.counters.lateSettlementCount += 1;
      status.lastLateSettlementAt = event.at;
      status.lastLateSettlementOutcome = event.outcome;
      return;
    case 'message-delete':
      status.counters.messageDeleteCount += 1;
      status.lastDeleteAt = event.at;
      return;
    case 'message-keep':
      status.counters.messageKeepCount += 1;
      status.lastKeepAt = event.at;
      return;
    case 'heartbeat-success':
      status.counters.heartbeatSuccessCount += 1;
      status.lastHeartbeatSuccessAt = event.at;
      return;
    case 'heartbeat-failure':
      status.counters.heartbeatFailureCount += 1;
      status.lastHeartbeatFailureAt = event.at;
      status.lastHeartbeatFailureMessage = describeUnknownError(event.error);
      return;
  }
}

async function settleHandler(promise: Promise<SqsWorkerHandlerResult | undefined>): Promise<SettledHandlerResult> {
  try {
    return { outcome: 'resolved', result: await promise };
  } catch (error: unknown) {
    return { outcome: 'rejected', error };
  }
}

function clearTimer(timer?: NodeJS.Timeout): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
