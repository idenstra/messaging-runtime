import type {
  SqsWorkerFiniteRunLifecycle,
  SqsWorkerFiniteRunResult,
  SqsWorkerRunBoundedOptions,
  SqsWorkerRunUntilIdleOptions,
} from '../core';
import { normalizeSignals } from './shared';
import type { SqsWorkerServiceLifecycle, SqsWorkerServiceRunOptions } from './types';

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

export async function runSqsWorkerManagerUntilIdle(
  manager: SqsWorkerFiniteRunLifecycle,
  options: SqsWorkerRunUntilIdleOptions = {},
): Promise<SqsWorkerFiniteRunResult> {
  return manager.runUntilIdle(options);
}

export async function runSqsWorkerManagerBounded(
  manager: SqsWorkerFiniteRunLifecycle,
  options: SqsWorkerRunBoundedOptions,
): Promise<SqsWorkerFiniteRunResult> {
  return manager.runBounded(options);
}

export async function runSqsWorkerServiceUntilIdle(
  host: SqsWorkerFiniteRunLifecycle,
  options: SqsWorkerRunUntilIdleOptions = {},
): Promise<SqsWorkerFiniteRunResult> {
  return host.runUntilIdle(options);
}

export async function runSqsWorkerServiceBounded(
  host: SqsWorkerFiniteRunLifecycle,
  options: SqsWorkerRunBoundedOptions,
): Promise<SqsWorkerFiniteRunResult> {
  return host.runBounded(options);
}
