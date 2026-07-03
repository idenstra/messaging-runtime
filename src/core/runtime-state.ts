import type { Message as SqsSdkMessage } from '@aws-sdk/client-sqs';
import { createRouteStatus } from './status';
import type {
  SqsWorkerHandlerResult,
  SqsWorkerMessage,
  SqsWorkerMessageFinalizationReason,
  SqsWorkerRoute,
  SqsWorkerRouteConfig,
  SqsWorkerRouteStatus,
} from './types';

export interface NormalizedRoute<TPayload> extends SqsWorkerRoute<TPayload> {
  config: SqsWorkerRouteConfig;
}

export interface BufferedRouteMessage {
  rawMessage: SqsSdkMessage;
  receivedAtMs: number;
}

export interface PendingDeleteEntry {
  message: SqsWorkerMessage;
  reason: SqsWorkerMessageFinalizationReason;
  resolve: () => void;
}

export interface RouteDeleteBatchState {
  entries: PendingDeleteEntry[];
  flushTimer?: NodeJS.Timeout;
  flushPromise?: Promise<void>;
}

export interface RouteRuntime<TPayload> {
  route: NormalizedRoute<TPayload>;
  status: SqsWorkerRouteStatus;
  loop?: Promise<void>;
  tasks: Set<Promise<void>>;
  buffer: BufferedRouteMessage[];
  deleteBatch: RouteDeleteBatchState;
  pollAbortController?: AbortController;
  activityVersion: number;
  activityWaiter?: () => void;
}

type SqsWorkerVoidResult = ReturnType<() => void>;

export type SqsWorkerHandlerOutcome = SqsWorkerHandlerResult | SqsWorkerVoidResult | undefined;

export function createRouteRuntime<TPayload>(route: NormalizedRoute<TPayload>): RouteRuntime<TPayload> {
  return {
    route,
    status: createRouteStatus(route.name, route.queueUrl),
    buffer: [],
    deleteBatch: { entries: [] },
    tasks: new Set(),
    activityVersion: 0,
  };
}
