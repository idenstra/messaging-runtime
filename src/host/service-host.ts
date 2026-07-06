import type {
  SqsWorkerFiniteRunResult,
  SqsWorkerManagerSnapshot,
  SqsWorkerRouteStatus,
  SqsWorkerRunBoundedOptions,
  SqsWorkerRunUntilIdleOptions,
} from '../core';
import { SqsWorkerManager } from '../core';
import {
  indexRoutes,
  mergeReceivePolicy,
  mergeReceiveStrategy,
  mergeRouteConfig,
  parseSqsWorkerServiceManifest,
  resolveActiveRoutes,
} from './manifest';
import { createEmptyCounters } from './shared';
import type { SqsWorkerServiceHostOptions, SqsWorkerServiceLifecycle, SqsWorkerServiceManifest } from './types';

export class SqsWorkerServiceHost implements SqsWorkerServiceLifecycle {
  private readonly manifest: SqsWorkerServiceManifest;
  private readonly routesByName = new Map();
  private readonly activeRoutes;
  private manager?: SqsWorkerManager;
  private managerPromise?: Promise<SqsWorkerManager>;

  constructor(private readonly options: SqsWorkerServiceHostOptions) {
    this.manifest = parseSqsWorkerServiceManifest(options.manifest);
    this.routesByName = indexRoutes(options.routes);
    this.activeRoutes = resolveActiveRoutes(this.routesByName, this.manifest);
  }

  async start(): Promise<void> {
    const manager = await this.ensureManager();
    await manager.start();
  }

  async stop(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      return;
    }

    if (!this.managerPromise) {
      return;
    }

    const manager = await this.managerPromise;
    await manager.stop();
  }

  async runUntilIdle(options: SqsWorkerRunUntilIdleOptions = {}): Promise<SqsWorkerFiniteRunResult> {
    const manager = await this.ensureManager();
    return manager.runUntilIdle(options);
  }

  async runBounded(options: SqsWorkerRunBoundedOptions): Promise<SqsWorkerFiniteRunResult> {
    const manager = await this.ensureManager();
    return manager.runBounded(options);
  }

  getStatus(): SqsWorkerRouteStatus[] {
    return this.manager?.getStatus() ?? [];
  }

  getSnapshot(): SqsWorkerManagerSnapshot {
    return (
      this.manager?.getSnapshot() ?? {
        started: false,
        stopping: false,
        routeCount: 0,
        totalInFlight: 0,
        totalBuffered: 0,
        counters: createEmptyCounters(),
        routes: [],
      }
    );
  }

  private async ensureManager(): Promise<SqsWorkerManager> {
    if (this.manager) {
      return this.manager;
    }

    if (!this.managerPromise) {
      this.managerPromise = this.buildManager().then((manager) => {
        this.manager = manager;
        return manager;
      });
    }

    try {
      return await this.managerPromise;
    } catch (error) {
      this.managerPromise = undefined;
      throw error;
    }
  }

  private async buildManager(): Promise<SqsWorkerManager> {
    const manager = new SqsWorkerManager(this.options.client, {
      ...this.options.managerOptions,
      defaults: this.manifest.defaults,
      receiveDefaults: mergeReceivePolicy(this.options.managerOptions?.receiveDefaults, this.manifest.receiveDefaults),
    });

    for (const activeRoute of this.activeRoutes) {
      const queueUrl = await this.options.queueResolver.resolve(activeRoute.queue);
      const routeConfig = mergeRouteConfig(activeRoute.route.config, activeRoute.manifest.config);
      const receive = mergeReceiveStrategy(activeRoute.route.receive, activeRoute.manifest.receive);
      manager.register({
        name: activeRoute.route.name,
        queueUrl,
        decodePayload: activeRoute.route.decodePayload,
        handle: activeRoute.route.handle,
        onError: activeRoute.route.onError,
        lifecycle: activeRoute.route.lifecycle,
        config: routeConfig,
        receive,
      });
    }

    return manager;
  }
}
