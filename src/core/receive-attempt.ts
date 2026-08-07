import { randomUUID } from 'node:crypto';
import {
  DEFAULT_RECEIVE_POLICY,
  normalizeReceivePolicy,
  RECEIVE_REQUEST_ATTEMPT_ID_TTL_MS,
  validateReceiveRequestAttemptId,
} from './config';
import type { NormalizedReceiveStrategy, NormalizedRoute, RouteRuntime } from './runtime-state';
import type { SqsWorkerReceivePolicy, SqsWorkerReceiveStrategy } from './types';

export function normalizeReceiveStrategy(
  defaults: SqsWorkerReceivePolicy,
  receive: SqsWorkerReceiveStrategy | undefined,
): NormalizedReceiveStrategy {
  return {
    policy: normalizeReceivePolicy(defaults, receive?.policy),
    createRequestAttemptId: receive?.createRequestAttemptId,
  };
}

export function getReceiveRequestAttemptId<TPayload>(runtime: RouteRuntime<TPayload>): string | undefined {
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
