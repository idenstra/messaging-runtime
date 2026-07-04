import type { RouteRuntime } from './runtime-state';
import type { SqsWorkerLogger, SqsWorkerRouteLifecycleHooks } from './types';
import { describeUnknownError } from './utils';

export type SqsWorkerLifecyclePhase = keyof SqsWorkerRouteLifecycleHooks;

const LIFECYCLE_PHASES = new Set<SqsWorkerLifecyclePhase>(['beforeStart', 'afterStart', 'beforeStop', 'afterStop']);

export function validateLifecycleHooks(routeName: string, lifecycle: unknown): void {
  if (lifecycle === undefined) {
    return;
  }

  if (!isLifecycleHooksRecord(lifecycle)) {
    throw new Error(`SQS worker route ${routeName} has invalid lifecycle; expected an object.`);
  }

  for (const [phase, hook] of Object.entries(lifecycle)) {
    if (!LIFECYCLE_PHASES.has(phase as SqsWorkerLifecyclePhase)) {
      throw new Error(`SQS worker route ${routeName} declares unsupported lifecycle hook ${phase}.`);
    }
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

function isLifecycleHooksRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
