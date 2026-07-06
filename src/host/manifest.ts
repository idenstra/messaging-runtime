import type { SqsWorkerReceivePolicy, SqsWorkerReceiveStrategy, SqsWorkerRouteConfig } from '../core';
import {
  assertRecord,
  assertRouteName,
  parseJsonRecord,
  readOptionalBoolean,
  readOptionalReceivePolicyPatch,
  readOptionalRouteConfigPatch,
  readOptionalText,
} from './shared';
import type { SqsWorkerServiceManifest, SqsWorkerServiceManifestRoute, SqsWorkerServiceRegisteredRoute } from './types';

interface NormalizedManifestRoute {
  enabled: boolean;
  queue?: string;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: Partial<SqsWorkerReceivePolicy>;
}

export interface ResolvedServiceRoute {
  route: SqsWorkerServiceRegisteredRoute;
  queue: string;
  manifest: NormalizedManifestRoute;
}

export function parseSqsWorkerServiceManifest(input: unknown): SqsWorkerServiceManifest {
  const rawManifest =
    typeof input === 'string'
      ? parseJsonRecord(input, 'SQS worker service manifest JSON')
      : assertRecord(input, 'SQS worker service manifest');

  const defaults = readOptionalRouteConfigPatch(rawManifest.defaults, 'SQS worker service manifest defaults');
  const receiveDefaults = readOptionalReceivePolicyPatch(
    rawManifest.receiveDefaults,
    'SQS worker service manifest receiveDefaults',
  );
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
    const receive = readOptionalReceivePolicyPatch(
      routeEntry.receive,
      `SQS worker service manifest route ${normalizedRouteName} receive`,
    );

    routes[normalizedRouteName] = { enabled, queue, config, receive };
  }

  return { defaults, receiveDefaults, routes };
}

export function indexRoutes(
  routes: readonly SqsWorkerServiceRegisteredRoute[],
): Map<string, SqsWorkerServiceRegisteredRoute> {
  const routesByName = new Map<string, SqsWorkerServiceRegisteredRoute>();

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

export function resolveActiveRoutes(
  routesByName: Map<string, SqsWorkerServiceRegisteredRoute>,
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
      receive: routeManifest.receive,
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

export function mergeRouteConfig(
  routeConfig: Partial<SqsWorkerRouteConfig> | undefined,
  manifestConfig: Partial<SqsWorkerRouteConfig> | undefined,
): Partial<SqsWorkerRouteConfig> | undefined {
  if (!routeConfig && !manifestConfig) {
    return undefined;
  }

  return { ...routeConfig, ...manifestConfig };
}

export function mergeReceivePolicy(
  ...patches: Array<Partial<SqsWorkerReceivePolicy> | undefined>
): Partial<SqsWorkerReceivePolicy> | undefined {
  const merged: Partial<SqsWorkerReceivePolicy> = {};

  for (const patch of patches) {
    if (!patch) {
      continue;
    }

    Object.assign(merged, patch);
  }

  return Object.keys(merged).length === 0 ? undefined : merged;
}

export function mergeReceiveStrategy(
  routeReceive: SqsWorkerReceiveStrategy | undefined,
  manifestReceive: Partial<SqsWorkerReceivePolicy> | undefined,
): SqsWorkerReceiveStrategy | undefined {
  const policy = mergeReceivePolicy(routeReceive?.policy, manifestReceive);
  if (!policy && !routeReceive?.createRequestAttemptId) {
    return undefined;
  }

  return { policy, createRequestAttemptId: routeReceive?.createRequestAttemptId };
}
