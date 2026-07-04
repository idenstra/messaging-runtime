import { strict as assert } from 'node:assert';
import test from 'node:test';
import { runSqsWorkerServiceUntilSignal, SqsWorkerManager } from '../../src';
import { createDeferred, FakeSqsClient, sleep, waitFor } from './support';

test('rejects invalid route lifecycle hook declarations during registration', () => {
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  assert.throws(
    () =>
      manager.register({
        name: 'invalid-lifecycle',
        queueUrl: 'https://queue.test/invalid-lifecycle',
        handle: async () => undefined,
        lifecycle: 'bad' as never,
      }),
    /invalid lifecycle; expected an object/i,
  );

  assert.throws(
    () =>
      manager.register({
        name: 'invalid-before-start',
        queueUrl: 'https://queue.test/invalid-before-start',
        handle: async () => undefined,
        lifecycle: { beforeStart: 'bad' as never },
      }),
    /invalid lifecycle hook beforeStart; expected a function/i,
  );
});

test('runs lifecycle hooks in registration order on start and reverse order on stop', async () => {
  const events: string[] = [];
  const manager = new SqsWorkerManager(new FakeSqsClient([]), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'alpha',
    queueUrl: 'https://queue.test/alpha',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('alpha:beforeStart');
      },
      afterStart: () => {
        events.push(`alpha:afterStart:${manager.getStatus().filter((route) => route.running).length}`);
      },
      beforeStop: () => {
        events.push('alpha:beforeStop');
      },
      afterStop: () => {
        events.push('alpha:afterStop');
      },
    },
  });
  manager.register({
    name: 'beta',
    queueUrl: 'https://queue.test/beta',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('beta:beforeStart');
      },
      afterStart: () => {
        events.push(`beta:afterStart:${manager.getStatus().filter((route) => route.running).length}`);
      },
      beforeStop: () => {
        events.push('beta:beforeStop');
      },
      afterStop: () => {
        events.push('beta:afterStop');
      },
    },
  });

  await manager.start();
  await manager.stop();

  assert.deepEqual(events, [
    'alpha:beforeStart',
    'beta:beforeStart',
    'alpha:afterStart:2',
    'beta:afterStart:2',
    'beta:beforeStop',
    'alpha:beforeStop',
    'beta:afterStop',
    'alpha:afterStop',
  ]);
});

test('beforeStart failure aborts startup and runs reverse-order afterStop only for already-started routes', async () => {
  const events: string[] = [];
  const manager = new SqsWorkerManager(new FakeSqsClient([]));

  manager.register({
    name: 'alpha',
    queueUrl: 'https://queue.test/alpha',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('alpha:beforeStart');
      },
      afterStop: () => {
        events.push('alpha:afterStop');
      },
    },
  });
  manager.register({
    name: 'beta',
    queueUrl: 'https://queue.test/beta',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('beta:beforeStart');
        throw new Error('beta beforeStart failed');
      },
      afterStop: () => {
        events.push('beta:afterStop');
      },
    },
  });
  manager.register({
    name: 'gamma',
    queueUrl: 'https://queue.test/gamma',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('gamma:beforeStart');
      },
      afterStop: () => {
        events.push('gamma:afterStop');
      },
    },
  });

  await assert.rejects(
    async () => manager.start(),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /failed to start/i);
      assert.equal(error.errors.length, 1);
      return true;
    },
  );

  assert.deepEqual(events, ['alpha:beforeStart', 'beta:beforeStart', 'alpha:afterStop']);
  assert.equal(manager.getSnapshot().started, false);
  assert.equal(
    manager.getStatus().every((route) => route.running === false),
    true,
  );
});

test('afterStart failure aborts startup and runs reverse-order afterStop for all routes that completed beforeStart', async () => {
  const events: string[] = [];
  const manager = new SqsWorkerManager(new FakeSqsClient([]), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'alpha',
    queueUrl: 'https://queue.test/alpha',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('alpha:beforeStart');
      },
      afterStart: () => {
        events.push(`alpha:afterStart:${manager.getStatus().filter((route) => route.running).length}`);
      },
      afterStop: () => {
        events.push('alpha:afterStop');
      },
    },
  });
  manager.register({
    name: 'beta',
    queueUrl: 'https://queue.test/beta',
    handle: async () => undefined,
    lifecycle: {
      beforeStart: () => {
        events.push('beta:beforeStart');
      },
      afterStart: () => {
        events.push(`beta:afterStart:${manager.getStatus().filter((route) => route.running).length}`);
        throw new Error('beta afterStart failed');
      },
      afterStop: () => {
        events.push('beta:afterStop');
      },
    },
  });

  await assert.rejects(
    async () => manager.start(),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /failed to start/i);
      assert.equal(error.errors.length, 1);
      return true;
    },
  );

  assert.deepEqual(events, [
    'alpha:beforeStart',
    'beta:beforeStart',
    'alpha:afterStart:2',
    'beta:afterStart:2',
    'beta:afterStop',
    'alpha:afterStop',
  ]);
  assert.equal(manager.getSnapshot().started, false);
});

test('runs beforeStop before drain and afterStop after drain', async () => {
  const releaseHandler = createDeferred<void>();
  const events: string[] = [];
  const manager = new SqsWorkerManager(
    new FakeSqsClient([
      { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: JSON.stringify({ jobId: 'job-1' }) }] },
    ]),
    { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 } },
  );

  manager.register({
    name: 'jobs',
    queueUrl: 'https://queue.test/jobs',
    handle: async () => {
      events.push('handle:start');
      await releaseHandler.promise;
      events.push('handle:finish');
    },
    lifecycle: {
      beforeStop: () => {
        events.push('beforeStop');
      },
      afterStop: () => {
        events.push('afterStop');
      },
    },
  });

  await manager.start();
  await waitFor(() => events.includes('handle:start'));

  const stopPromise = manager.stop();
  await waitFor(() => events.includes('beforeStop'));
  assert.equal(events.includes('afterStop'), false);

  releaseHandler.resolve();
  await stopPromise;

  assert.deepEqual(events, ['handle:start', 'beforeStop', 'handle:finish', 'afterStop']);
});

test('aggregates stop hook failures after best-effort cleanup', async () => {
  const events: string[] = [];
  const manager = new SqsWorkerManager(new FakeSqsClient([]), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  manager.register({
    name: 'alpha',
    queueUrl: 'https://queue.test/alpha',
    handle: async () => undefined,
    lifecycle: {
      beforeStop: () => {
        events.push('alpha:beforeStop');
        throw new Error('alpha beforeStop failed');
      },
      afterStop: () => {
        events.push('alpha:afterStop');
      },
    },
  });
  manager.register({
    name: 'beta',
    queueUrl: 'https://queue.test/beta',
    handle: async () => undefined,
    lifecycle: {
      beforeStop: () => {
        events.push('beta:beforeStop');
      },
      afterStop: () => {
        events.push('beta:afterStop');
        throw new Error('beta afterStop failed');
      },
    },
  });

  await manager.start();

  await assert.rejects(
    async () => manager.stop(),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /failed to stop cleanly/i);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );

  assert.deepEqual(events, ['beta:beforeStop', 'alpha:beforeStop', 'beta:afterStop', 'alpha:afterStop']);
  assert.equal(manager.getSnapshot().started, false);
});

test('signal runner surfaces aggregated stop failures from lifecycle cleanup', async () => {
  const stopError = new AggregateError([new Error('cleanup failed')], 'cleanup failed');
  const host = {
    async start() {},
    async stop() {
      throw stopError;
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
        totalBuffered: 0,
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

  const runPromise = runSqsWorkerServiceUntilSignal(host, { signals: ['SIGUSR2'] });
  await sleep(10);
  process.emit('SIGUSR2', 'SIGUSR2');

  await assert.rejects(
    async () => runPromise,
    (error: unknown) => {
      assert.equal(error, stopError);
      return true;
    },
  );
});
