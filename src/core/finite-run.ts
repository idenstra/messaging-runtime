import type { RouteRuntime } from './runtime-state';
import type {
  SqsWorkerFiniteRunCompletionReason,
  SqsWorkerFiniteRunDefaults,
  SqsWorkerFiniteRunResult,
  SqsWorkerRunBoundedOptions,
  SqsWorkerRunUntilIdleOptions,
} from './types';

export const DEFAULT_FINITE_RUN_DEFAULTS: SqsWorkerFiniteRunDefaults = { idleEmptyReceiveWaves: 2 };

export interface NormalizedFiniteRunOptions {
  idleEmptyReceiveWaves: number;
  maxHandledMessagesPerRoute?: number;
}

export interface RouteFiniteRunState {
  idleEmptyReceiveWaves: number;
  consecutiveEmptyReceives: number;
  handledMessageCount: number;
  maxHandledMessagesPerRoute?: number;
}

export function normalizeFiniteRunDefaults(
  ...patches: Array<Partial<SqsWorkerFiniteRunDefaults> | undefined>
): SqsWorkerFiniteRunDefaults {
  const defaults: SqsWorkerFiniteRunDefaults = { ...DEFAULT_FINITE_RUN_DEFAULTS };

  for (const patch of patches) {
    if (!patch) {
      continue;
    }

    Object.assign(defaults, patch);
  }

  validateIdleEmptyReceiveWaves(defaults.idleEmptyReceiveWaves);
  return defaults;
}

export function normalizeRunUntilIdleOptions(
  defaults: SqsWorkerFiniteRunDefaults,
  options: SqsWorkerRunUntilIdleOptions | undefined,
): NormalizedFiniteRunOptions {
  const idleEmptyReceiveWaves = options?.idleEmptyReceiveWaves ?? defaults.idleEmptyReceiveWaves;
  validateIdleEmptyReceiveWaves(idleEmptyReceiveWaves);
  return { idleEmptyReceiveWaves };
}

export function normalizeRunBoundedOptions(
  defaults: SqsWorkerFiniteRunDefaults,
  options: SqsWorkerRunBoundedOptions,
): NormalizedFiniteRunOptions {
  validateMaxHandledMessagesPerRoute(options.maxHandledMessagesPerRoute);

  return {
    idleEmptyReceiveWaves: options.idleEmptyReceiveWaves ?? defaults.idleEmptyReceiveWaves,
    maxHandledMessagesPerRoute: options.maxHandledMessagesPerRoute,
  };
}

export function assignFiniteRunState<TPayload>(
  runtime: RouteRuntime<TPayload>,
  options: NormalizedFiniteRunOptions,
): void {
  runtime.finiteRun = {
    idleEmptyReceiveWaves: options.idleEmptyReceiveWaves,
    consecutiveEmptyReceives: 0,
    handledMessageCount: 0,
    maxHandledMessagesPerRoute: options.maxHandledMessagesPerRoute,
  };
}

export function clearFiniteRunState<TPayload>(runtime: RouteRuntime<TPayload>): void {
  runtime.finiteRun = undefined;
}

export function recordFiniteRunReceiveEmpty<TPayload>(runtime: RouteRuntime<TPayload>): void {
  if (!runtime.finiteRun) {
    return;
  }

  runtime.finiteRun.consecutiveEmptyReceives += 1;
}

export function recordFiniteRunMessagesReceived<TPayload>(runtime: RouteRuntime<TPayload>): void {
  if (!runtime.finiteRun) {
    return;
  }

  runtime.finiteRun.consecutiveEmptyReceives = 0;
}

export function recordFiniteRunHandlerStart<TPayload>(runtime: RouteRuntime<TPayload>): void {
  if (!runtime.finiteRun) {
    return;
  }

  runtime.finiteRun.handledMessageCount += 1;
}

export function getFiniteRunDemandCap<TPayload>(runtime: RouteRuntime<TPayload>): number | undefined {
  const maxHandledMessagesPerRoute = runtime.finiteRun?.maxHandledMessagesPerRoute;
  if (maxHandledMessagesPerRoute === undefined) {
    return undefined;
  }

  return Math.max(
    0,
    maxHandledMessagesPerRoute -
      (runtime.finiteRun?.handledMessageCount ?? 0) -
      runtime.status.inFlight -
      runtime.buffer.length,
  );
}

export function getFiniteRunCompletionReason<TPayload>(
  runtime: RouteRuntime<TPayload>,
): SqsWorkerFiniteRunCompletionReason | undefined {
  const state = runtime.finiteRun;
  if (!state) {
    return undefined;
  }

  if (runtime.status.inFlight !== 0 || runtime.buffer.length !== 0) {
    return undefined;
  }

  if (state.maxHandledMessagesPerRoute !== undefined && state.handledMessageCount >= state.maxHandledMessagesPerRoute) {
    return 'bounded';
  }

  if (state.consecutiveEmptyReceives >= state.idleEmptyReceiveWaves) {
    return 'idle';
  }

  return undefined;
}

export function buildFiniteRunResult(
  runtimes: readonly RouteRuntime<unknown>[],
  startedAt: Date,
  finishedAt: Date,
): SqsWorkerFiniteRunResult {
  return {
    startedAt,
    finishedAt,
    routes: runtimes.map((runtime) => {
      const completionReason = getFiniteRunCompletionReason(runtime);
      if (!completionReason) {
        throw new Error(`SQS worker finite run for route ${runtime.route.name} completed without a route result.`);
      }

      return {
        routeName: runtime.route.name,
        handledMessageCount: runtime.finiteRun?.handledMessageCount ?? 0,
        completionReason,
      };
    }),
  };
}

function validateIdleEmptyReceiveWaves(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('SQS worker finite-run idleEmptyReceiveWaves must be an integer >= 1.');
  }
}

function validateMaxHandledMessagesPerRoute(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('SQS worker finite-run maxHandledMessagesPerRoute must be an integer >= 1.');
  }
}
