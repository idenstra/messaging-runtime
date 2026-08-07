import type {
  SqsRuntimeClient,
  SqsWorkerAckAction,
  SqsWorkerErrorContext,
  SqsWorkerFiniteRunLifecycle,
  SqsWorkerHandlerContext,
  SqsWorkerHandlerResult,
  SqsWorkerManagerOptions,
  SqsWorkerMessage,
  SqsWorkerReceivePolicy,
  SqsWorkerRoute,
  SqsWorkerRouteConfig,
} from '../core';

export interface SqsWorkerServiceLifecycle extends SqsWorkerFiniteRunLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): import('../core').SqsWorkerRouteStatus[];
  getSnapshot(): import('../core').SqsWorkerManagerSnapshot;
}

export interface SqsWorkerQueueResolver {
  resolve(queue: string): Promise<string>;
}

export interface SqsWorkerServiceRoute<TPayload> extends Omit<SqsWorkerRoute<TPayload>, 'queueUrl'> {
  queue?: string;
}

export type SqsWorkerServiceRegisteredRoute = Omit<
  SqsWorkerServiceRoute<unknown>,
  'decodePayload' | 'handle' | 'onError'
> & {
  decodePayload?(message: SqsWorkerMessage): unknown;
  handle(
    context: SqsWorkerHandlerContext<unknown>,
  ): Promise<SqsWorkerHandlerResult | ReturnType<() => void> | undefined>;
  onError?(
    context: SqsWorkerErrorContext<unknown>,
  ):
    | SqsWorkerAckAction
    | ReturnType<() => void>
    | undefined
    | Promise<SqsWorkerAckAction | ReturnType<() => void> | undefined>;
};

export interface SqsWorkerServiceManifestRoute {
  enabled?: boolean;
  queue?: string;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: Partial<SqsWorkerReceivePolicy>;
}

export interface SqsWorkerServiceManifest {
  defaults?: Partial<SqsWorkerRouteConfig>;
  receiveDefaults?: Partial<SqsWorkerReceivePolicy>;
  routes: Record<string, SqsWorkerServiceManifestRoute>;
}

export interface SqsWorkerServiceHostOptions {
  client: SqsRuntimeClient;
  queueResolver: SqsWorkerQueueResolver;
  routes: readonly SqsWorkerServiceRegisteredRoute[];
  manifest: SqsWorkerServiceManifest;
  managerOptions?: Omit<SqsWorkerManagerOptions, 'defaults'>;
}

export interface SqsWorkerServiceRunOptions {
  signals?: readonly NodeJS.Signals[];
}
