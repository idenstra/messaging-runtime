export type SettledPromise<T> = { outcome: 'resolved'; result: T } | { outcome: 'rejected'; error: unknown };

export async function settlePromise<T>(promise: Promise<T>): Promise<SettledPromise<T>> {
  try {
    return { outcome: 'resolved', result: await promise };
  } catch (error: unknown) {
    return { outcome: 'rejected', error };
  }
}

export function clearTimer(timer?: NodeJS.Timeout): void {
  if (timer) {
    clearTimeout(timer);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function describeUnknownError(error: unknown): string {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
