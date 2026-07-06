import { SqsWorkerManager } from '../../../src/index';
import {
  BenchmarkMultiRouteWorkerRuntimeClient,
  type BenchmarkScenario,
  BenchmarkWorkerRuntimeClient,
  createBenchmarkMessages,
  createDeferred,
  createQueueUrl,
  onceAborted,
  runManagedBenchmarkScenario,
  sleep,
  waitFor,
} from '../support';
import { manyRouteCount } from './fixtures';

export function createWorkerBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    {
      name: 'worker:ack-delete',
      description: 'Single-message delete finalization baseline.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(1) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 } },
        );

        manager.register({ name: 'jobs', queueUrl: createQueueUrl('jobs'), handle: async () => undefined });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 1);
        });
      },
    },
    {
      name: 'worker:visibility-heartbeat',
      description: 'Single-message visibility heartbeat baseline.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(1) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async ({ heartbeat }) => {
            await heartbeat();
            return { action: 'keep' };
          },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(
            () =>
              manager.getSnapshot().counters.heartbeatSuccessCount === 1 &&
              manager.getSnapshot().counters.messageKeepCount === 1,
          );
        });
      },
    },
    {
      name: 'worker:single-route-full-batch',
      description: 'Current single-route full-batch receive and dispatch behavior.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(10) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 10 } },
        );

        manager.register({ name: 'jobs', queueUrl: createQueueUrl('jobs'), handle: async () => undefined });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 10);
        });
      },
    },
    {
      name: 'worker:many-routes-empty-poll',
      description: 'Route-loop scheduling overhead with many idle routes and empty receives.',
      iterationsPerSample: 5,
      async runIteration() {
        const queueUrls = Array.from({ length: manyRouteCount }, (_, index) => createQueueUrl(`route-${index + 1}`));
        const batchesByQueueUrl = Object.fromEntries(queueUrls.map((queueUrl) => [queueUrl, []]));
        const client = new BenchmarkMultiRouteWorkerRuntimeClient(batchesByQueueUrl);
        const manager = new SqsWorkerManager(client, {
          defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 1 },
        });

        for (const [index, queueUrl] of queueUrls.entries()) {
          manager.register({ name: `route-${index + 1}`, queueUrl, handle: async () => undefined });
        }

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.receiveEmptyCount >= manyRouteCount, { timeoutMs: 5_000 });
        });
      },
    },
    {
      name: 'worker:single-route-prefetch-hot-queue',
      description: 'Hot-queue throughput with bounded per-route prefetch and limited concurrency.',
      iterationsPerSample: 10,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(40) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 8 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async () => {
            await sleep(1);
          },
          config: { concurrency: 4 },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 40, { timeoutMs: 5_000 });
        });
      },
    },
    {
      name: 'worker:single-route-prefetch-delete-batch',
      description: 'Hot-queue throughput including route-local delete batch finalization.',
      iterationsPerSample: 10,
      async runIteration() {
        const client = new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(50) }]);
        const manager = new SqsWorkerManager(client, {
          defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 10 },
        });

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async () => {
            await sleep(1);
          },
          config: { concurrency: 5 },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 50, { timeoutMs: 5_000 });
        });
      },
    },
    {
      name: 'worker:failure-keep',
      description: 'Handler-failure path that resolves to keep.',
      iterationsPerSample: 10,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(4) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 4 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async () => {
            throw new Error('benchmark failure');
          },
          config: { concurrency: 2, failureAction: 'keep' },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(
            () =>
              manager.getSnapshot().counters.handlerFailureCount === 4 &&
              manager.getSnapshot().counters.messageKeepCount === 4,
            { timeoutMs: 5_000 },
          );
        });
      },
    },
    {
      name: 'worker:stop-drain-buffered',
      description: 'Stop/drain latency with a buffered message waiting behind an in-flight slot.',
      iterationsPerSample: 10,
      async runIteration() {
        const releaseFirstMessage = createDeferred<void>();
        const handledMessageIds: string[] = [];
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(2) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 2 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async ({ message }) => {
            handledMessageIds.push(message.messageId);
            if (message.messageId === 'message-1') {
              await releaseFirstMessage.promise;
            }
          },
          config: { concurrency: 1 },
        });

        await runManagedBenchmarkScenario(
          manager,
          async () => {
            await waitFor(() => manager.getStatus()[0]?.inFlight === 1 && manager.getStatus()[0]?.buffered === 1);
            releaseFirstMessage.resolve();
          },
          { beforeStop: () => releaseFirstMessage.resolve() },
        );

        if (handledMessageIds.length !== 2) {
          throw new Error(`Expected buffered drain to process both messages, observed ${handledMessageIds.length}.`);
        }
      },
    },
    {
      name: 'worker:timeout-buffered-backlog',
      description: 'Buffered backlog behavior while a cooperative timeout keeps the slot occupied.',
      iterationsPerSample: 10,
      async runIteration() {
        const startedMessageIds: string[] = [];
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(2) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, maxMessagesPerPoll: 2 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async ({ abortSignal, message }) => {
            startedMessageIds.push(message.messageId);
            if (message.messageId === 'message-1') {
              await onceAborted(abortSignal);
              await sleep(20);
            }
          },
          config: {
            concurrency: 1,
            heartbeatIntervalMs: 10,
            visibilityTimeoutSeconds: 30,
            handlerTimeoutMs: 10,
            timeoutStrategy: 'cooperative',
            failureAction: 'delete',
          },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 2, { timeoutMs: 5_000 });
        });

        if (startedMessageIds[0] !== 'message-1' || startedMessageIds[1] !== 'message-2') {
          throw new Error(`Unexpected timeout/backlog processing order: ${startedMessageIds.join(',')}`);
        }
      },
    },
    {
      name: 'worker:abandon-timeout',
      description: 'Abandon-timeout handling with late settlement and released worker slot.',
      iterationsPerSample: 10,
      async runIteration() {
        const startedMessageIds: string[] = [];
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([{ Messages: createBenchmarkMessages(2) }]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, maxMessagesPerPoll: 2 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: createQueueUrl('jobs'),
          handle: async ({ abortSignal, message }) => {
            startedMessageIds.push(message.messageId);
            if (message.messageId === 'message-1') {
              await onceAborted(abortSignal);
              await sleep(20);
            }
          },
          config: {
            concurrency: 1,
            heartbeatIntervalMs: 10,
            visibilityTimeoutSeconds: 30,
            handlerTimeoutMs: 10,
            timeoutStrategy: 'abandon',
            failureAction: 'delete',
          },
        });

        await runManagedBenchmarkScenario(manager, async () => {
          await waitFor(
            () =>
              manager.getSnapshot().counters.messageKeepCount === 1 &&
              manager.getSnapshot().counters.messageDeleteCount === 1 &&
              manager.getSnapshot().counters.lateSettlementCount === 1,
            { timeoutMs: 5_000 },
          );
        });

        if (startedMessageIds[0] !== 'message-1' || startedMessageIds[1] !== 'message-2') {
          throw new Error(`Unexpected abandon-timeout processing order: ${startedMessageIds.join(',')}`);
        }
      },
    },
  ];
}
