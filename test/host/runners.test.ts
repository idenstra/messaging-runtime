import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceBounded,
  runSqsWorkerServiceUntilIdle,
  runSqsWorkerServiceUntilSignal,
  SqsWorkerServiceHost,
} from '../../src';
import { FakeQueueResolver, FakeSqsClient, sleep } from './support';

test('service-host finite-run helpers delegate to the same host lifecycle surface', async () => {
  const idleQueueUrl = 'https://queue.test/idle';
  const idleHost = new SqsWorkerServiceHost({
    client: new FakeSqsClient(),
    queueResolver: new FakeQueueResolver({ 'idle-queue': idleQueueUrl }),
    routes: [
      {
        name: 'idle',
        queue: 'idle-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { idle: {} } }),
  });

  const idleResult = await runSqsWorkerServiceUntilIdle(idleHost, { idleEmptyReceiveWaves: 1 });
  assert.equal(idleResult.routes[0]?.completionReason, 'idle');

  const boundedQueueUrl = 'https://queue.test/bounded';
  const boundedClient = new FakeSqsClient().withMessage(boundedQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const boundedHost = new SqsWorkerServiceHost({
    client: boundedClient,
    queueResolver: new FakeQueueResolver({ 'dispatch-queue': boundedQueueUrl }),
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: {} } }),
  });

  const boundedResult = await runSqsWorkerServiceBounded(boundedHost, { maxHandledMessagesPerRoute: 1 });
  assert.equal(boundedResult.routes[0]?.completionReason, 'bounded');
});

test('runner starts and stops the host on process signal and removes its listeners', async () => {
  const events: string[] = [];
  const baselineSigterm = process.listenerCount('SIGTERM');
  const baselineSigint = process.listenerCount('SIGINT');
  const host = {
    async start() {
      events.push('start');
    },
    async stop() {
      events.push('stop');
    },
    getStatus() {
      return [];
    },
    getSnapshot() {
      return {
        started: false,
        stopping: false,
        routeCount: 0,
        totalInFlight: 0,
        counters: {
          receiveEmptyCount: 0,
          messagesReceivedCount: 0,
          handlerStartedCount: 0,
          handlerSuccessCount: 0,
          handlerFailureCount: 0,
          handlerTimeoutCount: 0,
          lateSettlementCount: 0,
          messageDeleteCount: 0,
          messageKeepCount: 0,
          heartbeatSuccessCount: 0,
          heartbeatFailureCount: 0,
          pollErrorCount: 0,
          deleteBatchFailureCount: 0,
          messageDeleteFailureCount: 0,
          preDispatchVisibilityFailureCount: 0,
          bufferedMessageDropCount: 0,
        },
        routes: [],
      };
    },
  };

  const runPromise = runSqsWorkerServiceUntilSignal(host);
  await sleep(10);
  process.emit('SIGTERM', 'SIGTERM');
  await runPromise;

  assert.deepEqual(events, ['start', 'stop']);
  assert.equal(process.listenerCount('SIGTERM'), baselineSigterm);
  assert.equal(process.listenerCount('SIGINT'), baselineSigint);
});
