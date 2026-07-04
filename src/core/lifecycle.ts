import type { RouteRuntime } from './runtime-state';
import type { SqsWorkerLogger, SqsWorkerRouteLifecycleHooks } from './types';
import { describeUnknownError } from './utils';

export type SqsWorkerLifecyclePhase = keyof SqsWorkerRouteLifecycleHooks;

const LIFECYCLE_PHASE_ORDER = ['beforeStart', 'afterStart', 'beforeStop', 'afterStop'] as const;
const LIFECYCLE_PHASES = new Set<SqsWorkerLifecyclePhase>(LIFECYCLE_PHASE_ORDER);

export function validateLifecycleHooks(routeName: string, lifecycle: unknown): void {
  if (lifecycle === undefined) {
    return;
  }

  if (!isLifecycleHooksRecord(lifecycle)) {
    throw new Error(`SQS worker route ${routeName} has invalid lifecycle; expected an object.`);
  }

  for (const key of Reflect.ownKeys(lifecycle)) {
    if (typeof key !== 'string' || !LIFECYCLE_PHASES.has(key as SqsWorkerLifecyclePhase)) {
      throw new Error(`SQS worker route ${routeName} declares unsupported lifecycle hook ${String(key)}.`);
    }
  }

  for (const phase of LIFECYCLE_PHASE_ORDER) {
    const hook = lifecycle[phase];
    if (hook !== undefined && typeof hook !== 'function') {
      throw new Error(`SQS worker route ${routeName} has invalid lifecycle hook ${phase}; expected a function.`);
    }
  }
}

export async function runLifecycleHook<TPayload>(
  runtime: RouteRuntime<TPayload>,
  phase: SqsWorkerLifecyclePhase,
  logger: SqsWorkerLogger,
): Promise<Error | undefined> {
  const hook = runtime.route.lifecycle?.[phase];
  if (!hook) {
    return undefined;
  }

  try {
    await hook();
    return undefined;
  } catch (error: unknown) {
    const detail = describeUnknownError(error);
    logger.error('SQS worker route lifecycle hook failed.', {
      routeName: runtime.route.name,
      queueUrl: runtime.route.queueUrl,
      phase,
      error: detail,
    });
    return new Error(`SQS worker route ${runtime.route.name} lifecycle hook ${phase} failed: ${detail}`, {
      cause: error,
    });
  }
}

function isLifecycleHooksRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
