import type {
  SqsWorkerErrorHook,
  SqsWorkerHandler,
  SqsWorkerMessage,
  SqsWorkerReceiveStrategy,
  SqsWorkerRoute,
  SqsWorkerRouteConfig,
  SqsWorkerRouteLifecycleHooks,
} from './core';
import type { SqsWorkerServiceRoute } from './host';
import type { DecodedSnsNotificationJson } from './transport';
import {
  decodeSnsNotificationJson as decodeSnsNotificationJsonImpl,
  decodeSqsJsonBody as decodeSqsJsonBodyImpl,
} from './transport';

interface DirectRouteBindingOptions {
  queueUrl: string;
  queue?: never;
}

interface ServiceRouteBindingOptions {
  queue?: string;
  queueUrl?: never;
}

type RouteBindingOptions = DirectRouteBindingOptions | ServiceRouteBindingOptions;

type RouteFactoryResult<TPayload, TBindingOptions extends RouteBindingOptions> = TBindingOptions extends {
  queueUrl: string;
}
  ? SqsWorkerRoute<TPayload>
  : SqsWorkerServiceRoute<TPayload>;

interface RouteFactorySharedOptions<TPayload> {
  name: string;
  handle: SqsWorkerHandler<TPayload>;
  onError?: SqsWorkerErrorHook<TPayload>;
  lifecycle?: SqsWorkerRouteLifecycleHooks;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: SqsWorkerReceiveStrategy;
}

export type SnsJsonQueueRouteMessageShape = 'payload' | 'envelope+payload';

export type SqsJsonRouteOptions<TPayload> = {
  name: string;
  handle: SqsWorkerHandler<TPayload>;
  onError?: SqsWorkerErrorHook<TPayload>;
  lifecycle?: SqsWorkerRouteLifecycleHooks;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: SqsWorkerReceiveStrategy;
} & RouteBindingOptions;

export type SqsStringRouteOptions = {
  name: string;
  handle: SqsWorkerHandler<string>;
  onError?: SqsWorkerErrorHook<string>;
  lifecycle?: SqsWorkerRouteLifecycleHooks;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: SqsWorkerReceiveStrategy;
} & RouteBindingOptions;

type SnsJsonQueueRoutePayload<
  TPayload,
  TMessageShape extends SnsJsonQueueRouteMessageShape,
> = TMessageShape extends 'envelope+payload' ? DecodedSnsNotificationJson<TPayload> : TPayload;

export type SnsJsonQueueRouteOptions<TPayload, TMessageShape extends SnsJsonQueueRouteMessageShape = 'payload'> = {
  name: string;
  handle: SqsWorkerHandler<TMessageShape extends 'envelope+payload' ? DecodedSnsNotificationJson<TPayload> : TPayload>;
  onError?: SqsWorkerErrorHook<
    TMessageShape extends 'envelope+payload' ? DecodedSnsNotificationJson<TPayload> : TPayload
  >;
  lifecycle?: SqsWorkerRouteLifecycleHooks;
  config?: Partial<SqsWorkerRouteConfig>;
  receive?: SqsWorkerReceiveStrategy;
  messageShape?: TMessageShape;
} & RouteBindingOptions;

export function sqsJsonRoute<TPayload>(
  options: SqsJsonRouteOptions<TPayload> & { queueUrl: string },
): SqsWorkerRoute<TPayload>;
export function sqsJsonRoute<TPayload>(
  options: SqsJsonRouteOptions<TPayload> & { queue?: string; queueUrl?: never },
): SqsWorkerServiceRoute<TPayload>;
export function sqsJsonRoute<TPayload, TBindingOptions extends RouteBindingOptions>(
  options: SqsJsonRouteOptions<TPayload> & TBindingOptions,
): RouteFactoryResult<TPayload, TBindingOptions> {
  return createRouteFactoryResult(
    options,
    (message) => decodeSqsJsonBodyImpl<TPayload>(message.body),
    'sqsJsonRoute',
  ) as RouteFactoryResult<TPayload, TBindingOptions>;
}

export function sqsStringRoute(options: SqsStringRouteOptions & { queueUrl: string }): SqsWorkerRoute<string>;
export function sqsStringRoute(
  options: SqsStringRouteOptions & { queue?: string; queueUrl?: never },
): SqsWorkerServiceRoute<string>;
export function sqsStringRoute<TBindingOptions extends RouteBindingOptions>(
  options: SqsStringRouteOptions & TBindingOptions,
): RouteFactoryResult<string, TBindingOptions> {
  return createRouteFactoryResult(options, decodeRequiredSqsBody, 'sqsStringRoute') as RouteFactoryResult<
    string,
    TBindingOptions
  >;
}

export function snsJsonQueueRoute<TPayload>(
  options: SnsJsonQueueRouteOptions<TPayload, 'payload'> & { queueUrl: string },
): SqsWorkerRoute<TPayload>;
export function snsJsonQueueRoute<TPayload>(
  options: SnsJsonQueueRouteOptions<TPayload, 'payload'> & { queue?: string; queueUrl?: never },
): SqsWorkerServiceRoute<TPayload>;
export function snsJsonQueueRoute<TPayload>(
  options: SnsJsonQueueRouteOptions<TPayload, 'envelope+payload'> & { queueUrl: string },
): SqsWorkerRoute<DecodedSnsNotificationJson<TPayload>>;
export function snsJsonQueueRoute<TPayload>(
  options: SnsJsonQueueRouteOptions<TPayload, 'envelope+payload'> & { queue?: string; queueUrl?: never },
): SqsWorkerServiceRoute<DecodedSnsNotificationJson<TPayload>>;
export function snsJsonQueueRoute<
  TPayload,
  TMessageShape extends SnsJsonQueueRouteMessageShape = 'payload',
  TBindingOptions extends RouteBindingOptions = ServiceRouteBindingOptions,
>(
  options: SnsJsonQueueRouteOptions<TPayload, TMessageShape> & TBindingOptions,
): RouteFactoryResult<SnsJsonQueueRoutePayload<TPayload, TMessageShape>, TBindingOptions> {
  return createRouteFactoryResult(
    options,
    (message) => {
      const decoded = decodeSnsNotificationJsonImpl<TPayload>(message.body);
      return (options.messageShape === 'envelope+payload' ? decoded : decoded.payload) as SnsJsonQueueRoutePayload<
        TPayload,
        TMessageShape
      >;
    },
    'snsJsonQueueRoute',
  ) as RouteFactoryResult<SnsJsonQueueRoutePayload<TPayload, TMessageShape>, TBindingOptions>;
}

function createRouteFactoryResult<TPayload>(
  options: RouteFactorySharedOptions<TPayload> & RouteBindingOptions,
  decodePayload: (message: SqsWorkerMessage) => TPayload,
  helperName: string,
): SqsWorkerRoute<TPayload> | SqsWorkerServiceRoute<TPayload> {
  const route = {
    name: assertNonEmptyText(options.name, `${helperName} name`),
    decodePayload,
    handle: options.handle,
    onError: options.onError,
    lifecycle: options.lifecycle,
    config: options.config,
    receive: options.receive,
  };

  const binding = resolveRouteBinding(options, helperName);
  return { ...route, ...binding };
}

function resolveRouteBinding(
  options: RouteBindingOptions,
  helperName: string,
): Pick<SqsWorkerRoute<unknown>, 'queueUrl'> | Pick<SqsWorkerServiceRoute<unknown>, 'queue'> | Record<never, never> {
  if (options.queueUrl !== undefined && options.queue !== undefined) {
    throw new Error(`${helperName} accepts either queueUrl or queue, but not both.`);
  }

  if (options.queueUrl !== undefined) {
    return { queueUrl: assertNonEmptyText(options.queueUrl, `${helperName} queueUrl`) };
  }

  if (options.queue !== undefined) {
    return { queue: assertNonEmptyText(options.queue, `${helperName} queue`) };
  }

  return {};
}

function decodeRequiredSqsBody(message: SqsWorkerMessage): string {
  if (message.body === undefined) {
    throw new Error('sqsStringRoute requires an SQS message body.');
  }

  return message.body;
}

function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}
