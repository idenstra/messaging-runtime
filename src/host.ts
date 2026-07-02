import type {
  SqsRuntimeClient,
  SqsWorkerManagerOptions,
  SqsWorkerManagerSnapshot,
  SqsWorkerRoute,
  SqsWorkerRouteConfig,
  SqsWorkerRouteStatus,
} from './core';
import { SqsWorkerManager } from './core';

export interface SqsWorkerServiceLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): SqsWorkerRouteStatus[];
  getSnapshot(): SqsWorkerManagerSnapshot;
}

export interface SqsWorkerQueueResolver {
  resolve(queue: string): Promise<string>;
}

export interface SqsWorkerServiceRoute<TPayload> extends Omit<SqsWorkerRoute<TPayload>, 'queueUrl'> {
  queue?: string;
}

export interface SqsWorkerServiceManifestRoute {
  enabled?: boolean;
  queue?: string;
  config?: Partial<SqsWorkerRouteConfig>;
}

export interface SqsWorkerServiceManifest {
  defaults?: Partial<SqsWorkerRouteConfig>;
  routes: Record<string, SqsWorkerServiceManifestRoute>;
}

export interface SqsWorkerServiceHostOptions {
  client: SqsRuntimeClient;
  queueResolver: SqsWorkerQueueResolver;
  routes: readonly SqsWorkerServiceRoute<unknown>[];
  manifest: SqsWorkerServiceManifest;
  managerOptions?: Omit<SqsWorkerManagerOptions, 'defaults'>;
}

export interface SqsWorkerServiceRunOptions {
  signals?: readonly NodeJS.Signals[];
}

interface NormalizedManifestRoute {
  enabled: boolean;
  queue?: string;
  config?: Partial<SqsWorkerRouteConfig>;
}

interface ResolvedServiceRoute {
  route: SqsWorkerServiceRoute<unknown>;
  queue: string;
  manifest: NormalizedManifestRoute;
}

const DEFAULT_SIGNALS = ['SIGINT', 'SIGTERM'] as const satisfies readonly NodeJS.Signals[];
const ROUTE_CONFIG_KEYS = new Set<keyof SqsWorkerRouteConfig>([
  'concurrency',
  'waitTimeSeconds',
  'visibilityTimeoutSeconds',
  'heartbeatIntervalMs',
  'emptyReceiveDelayMs',
  'errorBackoffMs',
  'maxMessagesPerPoll',
  'handlerTimeoutMs',
  'timeoutStrategy',
  'failureAction',
]);

export class SqsWorkerServiceHost implements SqsWorkerServiceLifecycle {
  private readonly manifest: SqsWorkerServiceManifest;
  private readonly routesByName = new Map<string, SqsWorkerServiceRoute<unknown>>();
  private readonly activeRoutes: ResolvedServiceRoute[];
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
    });

    for (const activeRoute of this.activeRoutes) {
      const queueUrl = await this.options.queueResolver.resolve(activeRoute.queue);
      const routeConfig = mergeRouteConfig(activeRoute.route.config, activeRoute.manifest.config);
      manager.register({
        name: activeRoute.route.name,
        queueUrl,
        decodePayload: activeRoute.route.decodePayload,
        handle: activeRoute.route.handle,
        onError: activeRoute.route.onError,
        config: routeConfig,
      });
    }

    return manager;
  }
}

export async function runSqsWorkerServiceUntilSignal(
  host: SqsWorkerServiceLifecycle,
  options: SqsWorkerServiceRunOptions = {},
): Promise<void> {
  const signals = normalizeSignals(options.signals);
  let stopRequested = false;
  let stopPromise: Promise<void> | undefined;

  const requestStop = (): void => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    stopPromise ??= host.stop();
  };

  const handlers = new Map<NodeJS.Signals, () => void>();
  const cleanup = (): void => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
    handlers.clear();
  };

  await host.start();

  try {
    await new Promise<void>((resolve) => {
      for (const signal of signals) {
        const handler = () => {
          cleanup();
          requestStop();
          resolve();
        };

        handlers.set(signal, handler);
        process.once(signal, handler);
      }
    });
  } finally {
    cleanup();
    requestStop();
    if (stopPromise) {
      await stopPromise;
    }
  }
}

export function parseSqsWorkerServiceManifest(input: unknown): SqsWorkerServiceManifest {
  const rawManifest =
    typeof input === 'string'
      ? parseJsonRecord(input, 'SQS worker service manifest JSON')
      : assertRecord(input, 'SQS worker service manifest');

  const defaults = readOptionalRouteConfigPatch(rawManifest.defaults, 'SQS worker service manifest defaults');
  const rawRoutes = assertRecord(rawManifest.routes, 'SQS worker service manifest routes');
  const routes: Record<string, SqsWorkerServiceManifestRoute> = {};

  for (const [routeName, rawRouteEntry] of Object.entries(rawRoutes)) {
    const normalizedRouteName = assertRouteName(routeName);
    if (normalizedRouteName in routes) {
      throw new Error(`SQS worker service manifest declares duplicate route entries for ${normalizedRouteName}.`);
    }
    const routeEntry = assertRecord(rawRouteEntry, `SQS worker service manifest route ${normalizedRouteName}`);
    const enabled = readOptionalBoolean(
      routeEntry.enabled,
      `SQS worker service manifest route ${normalizedRouteName} enabled`,
    );
    const queue = readOptionalText(routeEntry.queue, `SQS worker service manifest route ${normalizedRouteName} queue`);
    const config = readOptionalRouteConfigPatch(
      routeEntry.config,
      `SQS worker service manifest route ${normalizedRouteName} config`,
    );

    routes[normalizedRouteName] = { enabled, queue, config };
  }

  return { defaults, routes };
}

function indexRoutes(routes: readonly SqsWorkerServiceRoute<unknown>[]): Map<string, SqsWorkerServiceRoute<unknown>> {
  const routesByName = new Map<string, SqsWorkerServiceRoute<unknown>>();

  for (const route of routes) {
    const routeName = assertRouteName(route.name);
    if (route.queue !== undefined && !route.queue.trim()) {
      throw new Error(`SQS worker service route ${routeName} has an invalid default queue identifier.`);
    }
    if (routesByName.has(routeName)) {
      throw new Error(`SQS worker service route ${routeName} is already registered.`);
    }

    routesByName.set(routeName, { ...route, name: routeName, queue: route.queue?.trim() });
  }

  return routesByName;
}

function resolveActiveRoutes(
  routesByName: Map<string, SqsWorkerServiceRoute<unknown>>,
  manifest: SqsWorkerServiceManifest,
): ResolvedServiceRoute[] {
  const activeRoutes: ResolvedServiceRoute[] = [];

  for (const [routeName, routeManifest] of Object.entries(manifest.routes)) {
    const route = routesByName.get(routeName);
    if (!route) {
      throw new Error(`SQS worker service manifest route ${routeName} does not match any registered route.`);
    }

    const normalizedManifest: NormalizedManifestRoute = {
      enabled: routeManifest.enabled ?? true,
      queue: routeManifest.queue,
      config: routeManifest.config,
    };

    if (!normalizedManifest.enabled) {
      continue;
    }

    const queue = normalizedManifest.queue ?? route.queue;
    if (!queue?.trim()) {
      throw new Error(
        `SQS worker service route ${routeName} is enabled but has no queue binding in the manifest or route definition.`,
      );
    }

    activeRoutes.push({ route, queue: queue.trim(), manifest: normalizedManifest });
  }

  return activeRoutes;
}

function mergeRouteConfig(
  routeConfig: Partial<SqsWorkerRouteConfig> | undefined,
  manifestConfig: Partial<SqsWorkerRouteConfig> | undefined,
): Partial<SqsWorkerRouteConfig> | undefined {
  if (!routeConfig && !manifestConfig) {
    return undefined;
  }

  return { ...routeConfig, ...manifestConfig };
}

function normalizeSignals(signals: readonly NodeJS.Signals[] | undefined): NodeJS.Signals[] {
  const configuredSignals = signals ?? DEFAULT_SIGNALS;
  const uniqueSignals = [...new Set(configuredSignals)];

  if (uniqueSignals.length === 0) {
    throw new Error('SQS worker service runner must be configured with at least one stop signal.');
  }

  return uniqueSignals;
}

function parseJsonRecord(source: string, label: string): Record<string, unknown> {
  try {
    return assertRecord(JSON.parse(source), label);
  } catch (error) {
    throw new Error(`Invalid ${label}.`, { cause: error });
  }
}

function readOptionalRouteConfigPatch(value: unknown, label: string): Partial<SqsWorkerRouteConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const config = assertRecord(value, label);
  const patch: Partial<SqsWorkerRouteConfig> = {};

  for (const [key, rawValue] of Object.entries(config)) {
    if (!ROUTE_CONFIG_KEYS.has(key as keyof SqsWorkerRouteConfig)) {
      throw new Error(`Invalid ${label} field ${key}.`);
    }

    switch (key) {
      case 'timeoutStrategy':
        if (rawValue !== 'cooperative' && rawValue !== 'abandon') {
          throw new Error(`Invalid ${label} timeoutStrategy; expected cooperative or abandon.`);
        }
        patch.timeoutStrategy = rawValue;
        break;
      case 'failureAction':
        if (rawValue !== 'delete' && rawValue !== 'keep') {
          throw new Error(`Invalid ${label} failureAction; expected delete or keep.`);
        }
        patch.failureAction = rawValue;
        break;
      case 'concurrency':
      case 'waitTimeSeconds':
      case 'visibilityTimeoutSeconds':
      case 'heartbeatIntervalMs':
      case 'emptyReceiveDelayMs':
      case 'errorBackoffMs':
      case 'maxMessagesPerPoll':
      case 'handlerTimeoutMs':
        patch[key] = readInteger(rawValue, `${label} field ${key}`);
        break;
      default:
        throw new Error(`Unhandled ${label} field ${key}.`);
    }
  }

  return patch;
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}; expected a boolean.`);
  }
  return value;
}

function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}; expected a non-empty string.`);
  }
  return value.trim();
}

function assertRouteName(routeName: string): string {
  if (!routeName.trim()) {
    throw new Error('SQS worker service route name must be a non-empty string.');
  }
  return routeName.trim();
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}; expected an object.`);
  }
  return value as Record<string, unknown>;
}

function createEmptyCounters(): SqsWorkerManagerSnapshot['counters'] {
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

function readInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${label}; expected an integer.`);
  }

  return value as number;
}
