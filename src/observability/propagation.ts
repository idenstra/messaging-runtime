import { type Context, context } from '@opentelemetry/api';
import {
  extractStringMessageAttributeCarrier,
  injectTraceContextIntoMessageAttributes,
  textMapGetter,
  textMapSetter,
} from './shared';
import type {
  ExtractTraceContextFromSqsMessageOptions,
  SnsMessageAttributes,
  SqsMessageAttributes,
  SqsWorkerMessage,
  TraceContextMessageAttributeOptions,
} from './types';

export function injectTraceContextIntoSqsMessageAttributes(
  options: TraceContextMessageAttributeOptions<SqsMessageAttributes>,
): SqsMessageAttributes {
  const carrier: Record<string, string> = {};
  options.propagator.inject(options.carrierContext ?? context.active(), carrier, textMapSetter);
  return injectTraceContextIntoMessageAttributes(options.messageAttributes, carrier);
}

export function injectTraceContextIntoSnsMessageAttributes(
  options: TraceContextMessageAttributeOptions<SnsMessageAttributes>,
): SnsMessageAttributes {
  const carrier: Record<string, string> = {};
  options.propagator.inject(options.carrierContext ?? context.active(), carrier, textMapSetter);
  return injectTraceContextIntoMessageAttributes(options.messageAttributes, carrier);
}

export function extractTraceContextFromSqsMessage(
  message: SqsWorkerMessage,
  options: ExtractTraceContextFromSqsMessageOptions,
): Context {
  const carrier = extractStringMessageAttributeCarrier(message.messageAttributes);
  return options.propagator.extract(options.carrierContext ?? context.active(), carrier, textMapGetter);
}
