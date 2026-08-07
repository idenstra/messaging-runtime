import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseSqsWorkerServiceManifest, SqsWorkerServiceHost } from '../../src';
import { FakeQueueResolver, FakeSqsClient } from './support';

test('service host preserves shared route lifecycle hooks without adding manifest lifecycle knobs', async () => {
  const events: string[] = [];
  const host = new SqsWorkerServiceHost({
    client: new FakeSqsClient(),
    queueResolver: new FakeQueueResolver({ 'dispatch-queue': 'https://queue.test/dispatch' }),
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        lifecycle: {
          beforeStart: () => {
            events.push('beforeStart');
          },
          afterStart: () => {
            events.push('afterStart');
          },
          beforeStop: () => {
            events.push('beforeStop');
          },
          afterStop: () => {
            events.push('afterStop');
          },
        },
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: {} } }),
  });

  await host.start();
  await host.stop();

  assert.deepEqual(events, ['beforeStart', 'afterStart', 'beforeStop', 'afterStop']);
});

test('service host exposes finite-run methods on top of manager defaults', async () => {
  const dispatchQueueUrl = 'https://queue.test/dispatch';
  const client = new FakeSqsClient().withMessage(dispatchQueueUrl, {
    MessageId: 'm1',
    ReceiptHandle: 'r1',
    Body: JSON.stringify({ type: 'dispatch' }),
  });
  const host = new SqsWorkerServiceHost({
    client,
    queueResolver: new FakeQueueResolver({ 'dispatch-queue': dispatchQueueUrl }),
    routes: [
      {
        name: 'dispatch',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { dispatch: {} } }),
    managerOptions: { finiteRunDefaults: { idleEmptyReceiveWaves: 1 } },
  });

  const result = await host.runUntilIdle();

  assert.equal(client.receiveInputs.length, 2);
  assert.deepEqual(result.routes, [{ routeName: 'dispatch', handledMessageCount: 1, completionReason: 'idle' }]);
});
