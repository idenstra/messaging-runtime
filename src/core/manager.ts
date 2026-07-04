import { randomUUID } from 'node:crypto';
import {
  DEFAULT_LOGGER,
  DEFAULT_RECEIVE_POLICY,
  DEFAULT_ROUTE_CONFIG,
  normalizeReceivePolicy,
  RECEIVE_REQUEST_ATTEMPT_ID_TTL_MS,
  ROUTE_ACTIVITY_WAIT_MS,
  validateReceiveRequestAttemptId,
  validateRoute,
  WORKER_RECEIVE_MESSAGE_ATTRIBUTE_NAMES,
  WORKER_RECEIVE_MESSAGE_SYSTEM_ATTRIBUTE_NAMES,
} from './config';
import { type DeleteBatchDependencies, flushPendingDeletes, queueDelete } from './delete-batch';
import { runLifecycleHook, type SqsWorkerLifecyclePhase, validateLifecycleHooks } from './lifecycle';
import { defaultDecodePayload } from './message';
import {
  calculateRouteDemand,
  dispatchBufferedMessages,
  startMessageTask,
  type WorkerProcessingDependencies,
  waitForRouteActivity,
} from './processing';
import {
  createRouteRuntime,
  type NormalizedReceiveStrategy,
  type NormalizedRoute,
  type RouteRuntime,
} from './runtime-state';
import {
  addCounters,
  cloneRouteStatus,
  createCounters,
  recordEvent,
  recordInfrastructureError,
  recordInfrastructureEvent,
} from './status';
import type {
  SqsRuntimeClient,
  SqsWorkerLogger,
  SqsWorkerManagerOptions,
  SqsWorkerManagerSnapshot,
  SqsWorkerReceivePolicy,
  SqsWorkerReceiveStrategy,
  SqsWorkerRoute,
  SqsWorkerRouteStatus,
  SqsWorkerRuntimeEvent,
} from './types';
import { describeUnknownError, isAbortError, sleep } from './utils';

export class SqsWorkerManager {
  private readonly logger: SqsWorkerLogger;
  private readonly defaults: Partial<import('./types').SqsWorkerRouteConfig>;
  private readonly receiveDefaults: SqsWorkerReceivePolicy;
  private readonly onEvent?: import('./types').SqsWorkerRuntimeEventHook;
  private readonly routes = new Map<string, RouteRuntime<unknown>>();
  private readonly deleteBatchDependencies: DeleteBatchDependencies;
  private readonly processingDependencies: WorkerProcessingDependencies;
  private started = false;
  private stopping = false;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;

  constructor(
    private readonly client: SqsRuntimeClient,
    options: SqsWorkerManagerOptions = {},
  ) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.defaults = options.defaults ?? {};
    this.receiveDefaults = normalizeReceivePolicy(options.receiveDefaults);
    this.onEvent = options.onEvent;

    this.deleteBatchDependencies = {
      client: this.client,
      logger: this.logger,
      emitRuntimeEvent: (status, event) => {
        this.emitRuntimeEvent(status, event);
      },
      emitInfrastructureRuntimeEvent: (status, event) => {
        this.emitInfrastructureRuntimeEvent(status, event);
      },
      isStopping: () => this.stopping,
    };

    this.processingDependencies = {
      client: this.client,
      logger: this.logger,
      emitRuntimeEvent: (status, event) => {
        this.emitRuntimeEvent(status, event);
      },
      emitInfrastructureRuntimeEvent: (status, event) => {
        this.emitInfrastructureRuntimeEvent(status, event);
      },
      recordInfrastructureError,
      queueDelete: async (runtime, message, reason) => {
        await queueDelete(runtime, message, reason, this.deleteBatchDependencies);
      },
      signalRouteActivity: (runtime) => {
        this.signalRouteActivity(runtime);
      },
    };
  }

  register<TPayload>(route: SqsWorkerRoute<TPayload>): void {
    if (this.started || this.startPromise) {
      throw new Error('Cannot register new SQS worker routes after the manager has started.');
    }
    if (this.routes.has(route.name)) {
      throw new Error(`SQS worker route ${route.name} is already registered.`);
    }
    if (route.onError !== undefined && typeof route.onError !== 'function') {
      throw new Error(`SQS worker route ${route.name} has invalid onError; expected a function.`);
    }
    validateLifecycleHooks(route.name, route.lifecycle);

    const normalizedReceive = normalizeReceiveStrategy(this.receiveDefaults, route.receive);
    const normalized: NormalizedRoute<TPayload> = {
      ...route,
      decodePayload: route.decodePayload ?? defaultDecodePayload<TPayload>,
      config: { ...DEFAULT_ROUTE_CONFIG, ...this.defaults, ...route.config },
      receive: normalizedReceive,
    };
    validateRoute(route.name, route.queueUrl, normalized.config, normalized.receive);

    this.routes.set(route.name, createRouteRuntime(normalized) as RouteRuntime<unknown>);
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    if (!this.startPromise) {
      const promise = this.startInternal();
      this.startPromise = promise;
      try {
        await promise;
      } finally {
        if (this.startPromise === promise) {
          this.startPromise = undefined;
        }
      }
      return;
    }

    await this.startPromise;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    if (!this.stopPromise) {
      const promise = this.stopInternal();
      this.stopPromise = promise;
      try {
        await promise;
      } finally {
        if (this.stopPromise === promise) {
          this.stopPromise = undefined;
        }
      }
      return;
    }

    await this.stopPromise;
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
      totalBuffered: routes.reduce((total, route) => total + route.buffered, 0),
      counters: routes.reduce((aggregate, route) => addCounters(aggregate, route.counters), createCounters()),
      routes,
    };
  }

  private async runRouteLoop<TPayload>(runtime: RouteRuntime<TPayload>): Promise<void> {
    const { route, status } = runtime;

    while (true) {
      const activityVersion = runtime.activityVersion;
      await dispatchBufferedMessages(runtime, this.processingDependencies);
      if (this.stopping) {
        if (runtime.buffer.length === 0 && status.inFlight === 0) {
          break;
        }
        await waitForRouteActivity(runtime, ROUTE_ACTIVITY_WAIT_MS, activityVersion);
        continue;
      }

      const demand = calculateRouteDemand(runtime);
      if (demand <= 0) {
        await waitForRouteActivity(runtime, ROUTE_ACTIVITY_WAIT_MS, activityVersion);
        continue;
      }

      try {
        const abortController = new AbortController();
        runtime.pollAbortController = abortController;
        const receiveRequestAttemptId = getReceiveRequestAttemptId(runtime);
        const response = await this.client.receiveMessage(
          {
            QueueUrl: route.queueUrl,
            MaxNumberOfMessages: Math.max(1, Math.min(10, demand, route.config.maxMessagesPerPoll)),
            WaitTimeSeconds: route.config.waitTimeSeconds,
            VisibilityTimeout: route.config.visibilityTimeoutSeconds,
            MessageSystemAttributeNames: [...WORKER_RECEIVE_MESSAGE_SYSTEM_ATTRIBUTE_NAMES],
            MessageAttributeNames: [...WORKER_RECEIVE_MESSAGE_ATTRIBUTE_NAMES],
            ...(receiveRequestAttemptId ? { ReceiveRequestAttemptId: receiveRequestAttemptId } : {}),
          },
          { abortSignal: abortController.signal },
        );
        if (runtime.pollAbortController === abortController) {
          runtime.pollAbortController = undefined;
        }
        runtime.pendingReceiveRequestAttempt = undefined;

        const messages = (response.Messages ?? []).slice(0, demand);
        if (messages.length === 0) {
          this.emitRuntimeEvent(status, {
            type: 'receive-empty',
            at: new Date(),
            routeName: route.name,
            queueUrl: route.queueUrl,
          });
          await waitForRouteActivity(runtime, route.config.emptyReceiveDelayMs, runtime.activityVersion);
          continue;
        }

        this.emitRuntimeEvent(status, {
          type: 'messages-received',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          messageCount: messages.length,
        });

        const immediateDispatchCount = Math.max(
          0,
          Math.min(messages.length, route.config.concurrency - status.inFlight),
        );
        for (const rawMessage of messages.slice(0, immediateDispatchCount)) {
          startMessageTask(runtime, rawMessage, this.processingDependencies);
        }

        const bufferedMessages = messages.slice(immediateDispatchCount);
        if (bufferedMessages.length > 0) {
          const receivedAtMs = Date.now();
          runtime.buffer.push(...bufferedMessages.map((rawMessage) => ({ rawMessage, receivedAtMs })));
          this.signalRouteActivity(runtime);
        }

        status.buffered = runtime.buffer.length;
      } catch (error) {
        runtime.pollAbortController = undefined;
        if (this.stopping && isAbortError(error)) {
          continue;
        }
        const detail = describeUnknownError(error);
        this.emitInfrastructureRuntimeEvent(status, {
          type: 'poll-error',
          at: new Date(),
          routeName: route.name,
          queueUrl: route.queueUrl,
          error,
          errorDetail: detail,
          backoffMs: route.config.errorBackoffMs,
        });
        this.logger.error('SQS worker polling failed.', {
          routeName: route.name,
          queueUrl: route.queueUrl,
          error: detail,
        });
        await sleep(route.config.errorBackoffMs);
      }
    }
  }

  private async startInternal(): Promise<void> {
    const startedRuntimes: RouteRuntime<unknown>[] = [];
    let loopsStarted = false;

    this.stopping = false;

    try {
      for (const runtime of this.routes.values()) {
        const hookError = await runLifecycleHook(runtime, 'beforeStart', this.logger);
        if (hookError) {
          throw hookError;
        }
        startedRuntimes.push(runtime);
      }

      for (const runtime of startedRuntimes) {
        this.initializeRouteRuntime(runtime);
      }
      loopsStarted = true;

      for (const runtime of startedRuntimes) {
        const hookError = await runLifecycleHook(runtime, 'afterStart', this.logger);
        if (hookError) {
          throw hookError;
        }
      }

      this.started = true;
    } catch (error: unknown) {
      const cleanupErrors = await this.cleanupFailedStart(startedRuntimes, loopsStarted);
      throw new AggregateError([error, ...cleanupErrors], 'SQS worker manager failed to start.');
    } finally {
      if (!this.started) {
        this.stopping = false;
      }
    }
  }

  private async stopInternal(): Promise<void> {
    try {
      const errors = await this.shutdownRoutes([...this.routes.values()], { runBeforeStop: true, runAfterStop: true });
      if (errors.length > 0) {
        throw new AggregateError(errors, 'SQS worker manager failed to stop cleanly.');
      }
    } finally {
      this.started = false;
      this.stopping = false;
    }
  }

  private signalRouteActivity<TPayload>(runtime: RouteRuntime<TPayload>): void {
    runtime.activityVersion += 1;
    const waiter = runtime.activityWaiter;
    runtime.activityWaiter = undefined;
    waiter?.();
  }

  private async flushPendingDeletes<TPayload>(runtime: RouteRuntime<TPayload>): Promise<void> {
    await flushPendingDeletes(runtime, this.deleteBatchDependencies);
  }

  private initializeRouteRuntime<TPayload>(runtime: RouteRuntime<TPayload>): void {
    runtime.buffer = [];
    runtime.deleteBatch = { entries: [] };
    runtime.tasks.clear();
    runtime.loop = undefined;
    runtime.pollAbortController = undefined;
    runtime.pendingReceiveRequestAttempt = undefined;
    runtime.activityVersion = 0;
    runtime.activityWaiter = undefined;
    runtime.status.running = true;
    runtime.status.stopping = false;
    runtime.status.inFlight = 0;
    runtime.status.buffered = 0;
    runtime.loop = this.runRouteLoop(runtime);
  }

  private async cleanupFailedStart(
    startedRuntimes: readonly RouteRuntime<unknown>[],
    loopsStarted: boolean,
  ): Promise<unknown[]> {
    if (startedRuntimes.length === 0) {
      return [];
    }

    if (!loopsStarted) {
      return this.runLifecycleHooks(startedRuntimes, 'afterStop', true);
    }

    return this.shutdownRoutes(startedRuntimes, { runBeforeStop: false, runAfterStop: true });
  }

  private async shutdownRoutes(
    runtimes: readonly RouteRuntime<unknown>[],
    options: { runBeforeStop: boolean; runAfterStop: boolean },
  ): Promise<unknown[]> {
    const errors: unknown[] = [];
    if (runtimes.length === 0) {
      return errors;
    }

    this.stopping = true;

    for (const runtime of runtimes) {
      runtime.status.stopping = true;
      runtime.status.running = false;
      runtime.pollAbortController?.abort();
      this.signalRouteActivity(runtime);
    }

    if (options.runBeforeStop) {
      errors.push(...(await this.runLifecycleHooks(runtimes, 'beforeStop', true)));
    }

    await Promise.all(
      runtimes.map(async (runtime) => {
        try {
          await this.flushPendingDeletes(runtime);
          await runtime.loop;
          await Promise.all([...runtime.tasks]);
          await this.flushPendingDeletes(runtime);
        } catch (error: unknown) {
          errors.push(error);
        } finally {
          runtime.loop = undefined;
          runtime.pollAbortController = undefined;
          runtime.pendingReceiveRequestAttempt = undefined;
          runtime.status.running = false;
          runtime.status.stopping = false;
          runtime.status.buffered = runtime.buffer.length;
        }
      }),
    );

    if (options.runAfterStop) {
      errors.push(...(await this.runLifecycleHooks(runtimes, 'afterStop', true)));
    }

    return errors;
  }

  private async runLifecycleHooks(
    runtimes: readonly RouteRuntime<unknown>[],
    phase: SqsWorkerLifecyclePhase,
    reverseOrder = false,
  ): Promise<unknown[]> {
    const errors: unknown[] = [];
    const orderedRuntimes = reverseOrder ? [...runtimes].reverse() : [...runtimes];

    for (const runtime of orderedRuntimes) {
      const hookError = await runLifecycleHook(runtime, phase, this.logger);
      if (hookError) {
        errors.push(hookError);
      }
    }

    return errors;
  }

  private emitInfrastructureRuntimeEvent(status: SqsWorkerRouteStatus, event: SqsWorkerRuntimeEvent): void {
    recordInfrastructureEvent(status, event);
    this.emitRuntimeEvent(status, event);
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

function normalizeReceiveStrategy(
  defaults: SqsWorkerReceivePolicy,
  receive: SqsWorkerReceiveStrategy | undefined,
): NormalizedReceiveStrategy {
  return {
    policy: normalizeReceivePolicy(defaults, receive?.policy),
    createRequestAttemptId: receive?.createRequestAttemptId,
  };
}

function getReceiveRequestAttemptId<TPayload>(runtime: RouteRuntime<TPayload>): string | undefined {
  const mode = runtime.route.receive.policy.requestAttemptIdMode ?? DEFAULT_RECEIVE_POLICY.requestAttemptIdMode;
  if (mode === 'off') {
    return undefined;
  }

  const now = Date.now();
  const pendingAttempt = runtime.pendingReceiveRequestAttempt;
  if (pendingAttempt && now - pendingAttempt.createdAtMs < RECEIVE_REQUEST_ATTEMPT_ID_TTL_MS) {
    return pendingAttempt.value;
  }

  const nextAttemptId = createReceiveRequestAttemptId(runtime.route, mode);
  runtime.pendingReceiveRequestAttempt = { value: nextAttemptId, createdAtMs: now };
  return nextAttemptId;
}

function createReceiveRequestAttemptId<TPayload>(
  route: NormalizedRoute<TPayload>,
  mode: SqsWorkerReceivePolicy['requestAttemptIdMode'],
): string {
  if (mode === 'runtime') {
    return validateReceiveRequestAttemptId(route.name, randomUUID());
  }

  const customAttemptId = route.receive.createRequestAttemptId?.();
  if (customAttemptId === undefined) {
    throw new Error(
      `SQS worker route ${route.name} uses custom ReceiveRequestAttemptId mode but did not produce an attempt id.`,
    );
  }

  return validateReceiveRequestAttemptId(route.name, customAttemptId);
}
