import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { SqsWorkerHandler } from '../core';
import { extractTraceContextFromSqsMessage } from './propagation';
import { describeUnknownError, resolveSpanAttributes, resolveSpanName } from './shared';
import type { OpenTelemetrySqsWorkerTracingOptions } from './types';

export function withOpenTelemetrySqsWorkerTracing<TPayload, TRoute extends { handle: SqsWorkerHandler<TPayload> }>(
  route: TRoute,
  options: OpenTelemetrySqsWorkerTracingOptions<TPayload>,
): TRoute;
export function withOpenTelemetrySqsWorkerTracing<TPayload, TRoute extends { handle: SqsWorkerHandler<TPayload> }>(
  route: TRoute,
  options: OpenTelemetrySqsWorkerTracingOptions<TPayload>,
): TRoute {
  return {
    ...route,
    handle: async (handlerContext) => {
      const parentContext = extractTraceContextFromSqsMessage(handlerContext.message, {
        propagator: options.propagator,
        carrierContext: options.carrierContext,
      });
      const spanName = resolveSpanName(handlerContext, options.spanName);
      const span = options.tracer.startSpan(
        spanName,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'aws_sqs',
            'messaging.operation': 'process',
            'messaging_runtime.route_name': handlerContext.routeName,
            'messaging_runtime.queue_url': handlerContext.queueUrl,
            'messaging_runtime.message_id': handlerContext.message.messageId,
            ...resolveSpanAttributes(handlerContext, options.spanAttributes),
          },
        },
        parentContext,
      );

      return context.with(trace.setSpan(parentContext, span), async () => {
        try {
          const result = await route.handle(handlerContext);
          if (result?.action) {
            span.setAttribute('messaging_runtime.action', result.action);
          }
          return result;
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          } else {
            span.recordException({ name: 'NonErrorThrow', message: describeUnknownError(error) });
            span.setStatus({ code: SpanStatusCode.ERROR, message: describeUnknownError(error) });
          }
          throw error;
        } finally {
          span.end();
        }
      });
    },
  };
}
