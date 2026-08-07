import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type DecodedSnsNotificationJson,
  parseSqsWorkerServiceManifest,
  SqsWorkerManager,
  SqsWorkerServiceHost,
  type SqsWorkerServiceRoute,
  snsJsonQueueRoute,
  sqsJsonRoute,
  sqsStringRoute,
} from '../src';
import type { SqsWorkerMessage, SqsWorkerRoute } from '../src/core';
import { FakeSqsClient } from './core/support';

test('sqsJsonRoute creates a direct-manager route with JSON decoding and shared route settings', () => {
  const lifecycle = { beforeStart: () => undefined };
  const onError = async () => 'keep' as const;
  const handle = async ({ payload }: { payload: { jobId: string } }) => {
    assert.equal(payload.jobId, 'job-1');
  };

  const route = sqsJsonRoute<{ jobId: string }>({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs',
    onError,
    lifecycle,
    config: { concurrency: 8 },
    receive: { policy: { requestAttemptIdMode: 'off' } },
    handle,
  });

  const typedRoute: SqsWorkerRoute<{ jobId: string }> = route;
  void typedRoute;

  assert.equal(route.name, 'jobs');
  assert.equal(route.queueUrl, 'https://queue.test/jobs');
  assert.equal(route.handle, handle);
  assert.equal(route.onError, onError);
  assert.equal(route.lifecycle, lifecycle);
  assert.deepEqual(route.config, { concurrency: 8 });
  assert.deepEqual(route.receive, { policy: { requestAttemptIdMode: 'off' } });
  assert.deepEqual(route.decodePayload?.(createWorkerMessage(JSON.stringify({ jobId: 'job-1' }))), { jobId: 'job-1' });
  assert.throws(() => route.decodePayload?.(createWorkerMessage('')), /SQS message body must be a non-empty string/i);

  const manager = new SqsWorkerManager(new FakeSqsClient([]));
  manager.register(route);
  assert.equal(manager.getStatus().length, 1);
});

test('sqsStringRoute creates a service-host route, supports manifest-owned binding, and decodes required strings', async () => {
  const route = sqsStringRoute({
    name: 'raw-jobs',
    handle: async ({ payload }) => {
      assert.equal(payload, 'raw-body');
    },
  });

  const typedRoute: SqsWorkerServiceRoute<string> = route;
  void typedRoute;

  assert.equal(route.queue, undefined);
  assert.equal(route.queueUrl, undefined);
  assert.equal(route.decodePayload?.(createWorkerMessage('raw-body')), 'raw-body');
  assert.throws(
    () => route.decodePayload?.(createWorkerMessage(undefined)),
    /sqsStringRoute requires an SQS message body/i,
  );

  const host = new SqsWorkerServiceHost({
    client: new FakeSqsClient([]),
    queueResolver: { resolve: async (queue) => `https://queue.test/${queue}` },
    manifest: parseSqsWorkerServiceManifest({
      defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10 },
      routes: { 'raw-jobs': { queue: 'raw-jobs' } },
    }),
    routes: [route],
  });

  await host.start();
  assert.equal(host.getStatus().length, 1);
  await host.stop();
});

test('snsJsonQueueRoute defaults to payload-only mode and supports envelope-plus-payload mode', () => {
  const notificationBody = JSON.stringify({
    Type: 'Notification',
    MessageId: 'sns-1',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:user-events',
    Subject: 'UserCreated',
    Message: JSON.stringify({ userId: 'user-1' }),
    Timestamp: '2026-07-04T00:00:00.000Z',
  });

  const payloadRoute = snsJsonQueueRoute<{ userId: string }>({
    name: 'user-created',
    queueUrl: 'https://queue.test/user-created',
    handle: async ({ payload }) => {
      assert.equal(payload.userId, 'user-1');
    },
  });
  const payloadTypedRoute: SqsWorkerRoute<{ userId: string }> = payloadRoute;
  void payloadTypedRoute;

  assert.deepEqual(payloadRoute.decodePayload?.(createWorkerMessage(notificationBody)), { userId: 'user-1' });

  const envelopeRoute = snsJsonQueueRoute<{ userId: string }>({
    name: 'user-created-envelope',
    queue: 'user-created',
    messageShape: 'envelope+payload',
    handle: async ({ payload }) => {
      assert.equal(payload.envelope.TopicArn, 'arn:aws:sns:us-east-1:123456789012:user-events');
      assert.equal(payload.payload.userId, 'user-1');
    },
  });
  const envelopeTypedRoute: SqsWorkerServiceRoute<DecodedSnsNotificationJson<{ userId: string }>> = envelopeRoute;
  void envelopeTypedRoute;

  assert.deepEqual(envelopeRoute.decodePayload?.(createWorkerMessage(notificationBody)), {
    envelope: {
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:user-events',
      Subject: 'UserCreated',
      Message: JSON.stringify({ userId: 'user-1' }),
      Timestamp: '2026-07-04T00:00:00.000Z',
    },
    payload: { userId: 'user-1' },
  });
});

test('route factories reject queue and queueUrl being declared together', () => {
  assert.throws(
    () =>
      sqsJsonRoute({ name: 'jobs', queue: 'jobs', queueUrl: 'https://queue.test/jobs', handle: async () => undefined }),
    /accepts either queueUrl or queue, but not both/i,
  );

  assert.throws(
    () =>
      snsJsonQueueRoute({
        name: 'jobs',
        queue: 'jobs',
        queueUrl: 'https://queue.test/jobs',
        handle: async () => undefined,
      }),
    /accepts either queueUrl or queue, but not both/i,
  );
});

function createWorkerMessage(body: string | undefined): SqsWorkerMessage {
  return {
    messageId: 'message-1',
    receiptHandle: 'receipt-1',
    body,
    attributes: {},
    systemAttributes: {},
    messageAttributes: {},
    raw: {} as never,
  };
}
