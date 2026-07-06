import {
  DEFAULT_FINITE_RUN_DEFAULTS,
  DEFAULT_LOGGER,
  DEFAULT_ROUTE_CONFIG,
  normalizeReceivePolicy,
  ROUTE_ACTIVITY_WAIT_MS,
  validateRoute,
} from './config';
import { type DeleteBatchDependencies, flushPendingDeletes, queueDelete } from './delete-batch';
import {
  assignFiniteRunState,
  buildFiniteRunResult,
  clearFiniteRunState,
  getFiniteRunCompletionReason,
  normalizeFiniteRunDefaults,
  normalizeRunBoundedOptions,
  normalizeRunUntilIdleOptions,
} from './finite-run';
import { startMessageTask } from './handler-runner';
import { runLifecycleHook, type SqsWorkerLifecyclePhase, validateLifecycleHooks } from './lifecycle';
import { defaultDecodePayload } from './message';
import { type WorkerProcessingDependencies } from './processing';
import { normalizeReceiveStrategy } from './receive-attempt';
import { runRouteLoop } from './route-loop';
import { createRouteRuntime, type NormalizedRoute, type RouteRuntime } from './runtime-state';
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
  SqsWorkerFiniteRunDefaults,
  SqsWorkerFiniteRunResult,
  SqsWorkerLogger,
  SqsWorkerManagerOptions,
  SqsWorkerManagerSnapshot,
  SqsWorkerReceivePolicy,
  SqsWorkerRoute,
  SqsWorkerRouteStatus,
  SqsWorkerRunBoundedOptions,
  SqsWorkerRuntimeEvent,
  SqsWorkerRunUntilIdleOptions,
} from './types';
import { clearTimer, describeUnknownError } from './utils';

export class SqsWorkerManager {
  private readonly logger: SqsWorkerLogger;
  private readonly defaults: Partial<import('./types').SqsWorkerRouteConfig>;
  private readonly receiveDefaults: SqsWorkerReceivePolicy;
  private readonly finiteRunDefaults: SqsWorkerFiniteRunDefaults;
  private readonly onEvent?: import('./types').SqsWorkerRuntimeEventHook;
  private readonly routes = new Map<string, RouteRuntime<unknown>>();
  private readonly deleteBatchDependencies: DeleteBatchDependencies;
  private readonly processingDependencies: WorkerProcessingDependencies;
  private started = false;
  private stopping = false;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private managerActivityVersion = 0;
  private managerActivityWaiter?: () => void;

  constructor(
    private readonly client: SqsRuntimeClient,
    options: SqsWorkerManagerOptions = {},
  ) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.defaults = options.defaults ?? {};
    this.receiveDefaults = normalizeReceivePolicy(options.receiveDefaults);
    this.finiteRunDefaults = normalizeFiniteRunDefaults(DEFAULT_FINITE_RUN_DEFAULTS, options.finiteRunDefaults);
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
      startMessageTask: (runtime, rawMessage) => {
        startMessageTask(runtime, rawMessage, this.processingDependencies);
      },
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

  async runUntilIdle(options: SqsWorkerRunUntilIdleOptions = {}): Promise<SqsWorkerFiniteRunResult> {
    const finiteRunOptions = normalizeRunUntilIdleOptions(this.finiteRunDefaults, options);
    return this.runFinite(finiteRunOptions);
  }

  async runBounded(options: SqsWorkerRunBoundedOptions): Promise<SqsWorkerFiniteRunResult> {
    const finiteRunOptions = normalizeRunBoundedOptions(this.finiteRunDefaults, options);
    return this.runFinite(finiteRunOptions);
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
      this.signalManagerActivity();
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
    this.signalManagerActivity();
  }

  private signalManagerActivity(): void {
    this.managerActivityVersion += 1;
    const waiter = this.managerActivityWaiter;
    this.managerActivityWaiter = undefined;
    waiter?.();
  }

  private assertFiniteRunAvailable(): void {
    if (this.started || this.startPromise || this.stopping || this.stopPromise) {
      throw new Error('Cannot run SQS worker finite-run execution while the manager is already running or stopping.');
    }
  }

  private async runFinite(options: {
    idleEmptyReceiveWaves: number;
    maxHandledMessagesPerRoute?: number;
  }): Promise<SqsWorkerFiniteRunResult> {
    this.assertFiniteRunAvailable();

    const runtimes = [...this.routes.values()];
    const startedAt = new Date();
    for (const runtime of runtimes) {
      assignFiniteRunState(runtime, options);
    }

    try {
      await this.start();
      while (true) {
        const completion = this.getFiniteRunCompletion(runtimes);
        if (completion) {
          await this.stop();
          return buildFiniteRunResult(runtimes, startedAt, new Date());
        }

        await this.waitForManagerActivity(this.managerActivityVersion);
      }
    } finally {
      for (const runtime of runtimes) {
        clearFiniteRunState(runtime);
      }
    }
  }

  private getFiniteRunCompletion(
    runtimes: readonly RouteRuntime<unknown>[],
  ): Array<{ routeName: string; completionReason: string }> | undefined {
    const completion = runtimes.map((runtime) => ({
      routeName: runtime.route.name,
      completionReason: getFiniteRunCompletionReason(runtime),
    }));

    if (completion.every((route) => route.completionReason !== undefined)) {
      return completion as Array<{ routeName: string; completionReason: string }>;
    }

    return undefined;
  }

  private async waitForManagerActivity(observedActivityVersion: number): Promise<void> {
    if (this.managerActivityVersion !== observedActivityVersion) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const complete = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimer(timer);
        if (this.managerActivityWaiter === complete) {
          this.managerActivityWaiter = undefined;
        }
        resolve();
      };

      this.managerActivityWaiter = complete;
      timer = setTimeout(complete, ROUTE_ACTIVITY_WAIT_MS);
    });
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
    runtime.loop = runRouteLoop(runtime, {
      client: this.client,
      logger: this.logger,
      processingDependencies: this.processingDependencies,
      isStopping: () => this.stopping,
      emitRuntimeEvent: (status, event) => {
        this.emitRuntimeEvent(status, event);
      },
      emitInfrastructureRuntimeEvent: (status, event) => {
        this.emitInfrastructureRuntimeEvent(status, event);
      },
      signalRouteActivity: (routeRuntime) => {
        this.signalRouteActivity(routeRuntime);
      },
    });
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
    this.signalManagerActivity();

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
