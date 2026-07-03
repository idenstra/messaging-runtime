import type { SqsWorkerManagerSnapshot } from '../../src/index';
import {
  decodeSnsNotificationJson,
  decodeSqsJsonBody,
  SnsPublisher,
  SnsTopicArnResolver,
  SqsPublisher,
  SqsQueueUrlResolver,
  SqsWorkerManager,
} from '../../src/index';
import {
  BenchmarkMultiRouteWorkerRuntimeClient,
  type BenchmarkScenario,
  BenchmarkSnsTransportClient,
  BenchmarkSqsTransportClient,
  BenchmarkWorkerRuntimeClient,
  benchmarkSnsNotificationEnvelopeBody,
  benchmarkSqsJsonBody,
  createBenchmarkMessages,
  createDeferred,
  createQueueUrl,
  onceAborted,
  runManagedBenchmarkScenario,
  sleep,
  waitFor,
} from './support';

const manyRouteCount = 32;

export function createBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    {
      name: 'decode:sqs-json',
      description: 'Plain SQS JSON body decode throughput.',
      iterationsPerSample: 10_000,
      async runIteration() {
        decodeSqsJsonBody(benchmarkSqsJsonBody);
      },
    },
    {
      name: 'decode:sns-over-sqs-json',
      description: 'SNS envelope plus nested JSON payload decode throughput.',
      iterationsPerSample: 10_000,
      async runIteration() {
        decodeSnsNotificationJson(benchmarkSnsNotificationEnvelopeBody);
      },
    },
    {
      name: 'publisher:sqs-batch',
      description: 'SQS batch publish chunking and result aggregation.',
      iterationsPerSample: 50,
      async runIteration() {
        const client = new BenchmarkSqsTransportClient().withQueueUrl('jobs', createQueueUrl('jobs'));
        const publisher = new SqsPublisher(client);

        await publisher.sendJsonBatch({
          queue: 'jobs',
          entries: Array.from({ length: 100 }, (_, index) => ({
            id: `job-${index}`,
            payload: { jobId: `job-${index}` },
          })),
        });
      },
    },
    {
      name: 'publisher:sns-batch',
      description: 'SNS batch publish chunking and result aggregation.',
      iterationsPerSample: 50,
      async runIteration() {
        const publisher = new SnsPublisher(new BenchmarkSnsTransportClient());

        await publisher.publishJsonBatch({
          topic: 'arn:aws:sns:us-east-1:123456789012:events',
          entries: Array.from({ length: 100 }, (_, index) => ({
            id: `event-${index}`,
            payload: { eventId: `event-${index}` },
            subject: `Event ${index}`,
          })),
        });
      },
    },
    {
      name: 'resolver:cache-hit',
      description: 'Hot cache-hit resolution cost for mixed SQS and SNS workloads.',
      iterationsPerSample: 5_000,
      async runIteration() {
        const state = await getResolverCacheHitState();
        await state.sqsResolver.resolve('dispatch-queue');
        await state.sqsResolver.resolve('feedback-queue');
        await state.snsResolver.resolve('dispatch-events');
        await state.snsResolver.resolve('feedback-events');
      },
    },
    {
      name: 'resolver:cache-miss-fake-client',
      description: 'Cache-miss resolution through fake SQS GetQueueUrl and SNS ListTopics clients.',
      iterationsPerSample: 2_000,
      async runIteration() {
        const sqsClient = new BenchmarkSqsTransportClient()
          .withQueueUrl('dispatch-queue', createQueueUrl('dispatch-queue'))
          .withQueueUrl('feedback-queue', createQueueUrl('feedback-queue'));
        const snsClient = new BenchmarkSnsTransportClient()
          .withTopicArn('arn:aws:sns:us-east-1:123456789012:dispatch-events')
          .withTopicArn('arn:aws:sns:us-east-1:123456789012:feedback-events');
        const sqsResolver = new SqsQueueUrlResolver(sqsClient);
        const snsResolver = new SnsTopicArnResolver(snsClient);

        await sqsResolver.resolve('dispatch-queue');
        await sqsResolver.resolve('feedback-queue');
        await snsResolver.resolve('dispatch-events');
        await snsResolver.resolve('feedback-events');
      },
    },
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
    {
      name: 'snapshot:many-routes',
      description: 'Snapshot aggregation and cloning cost with many registered routes.',
      iterationsPerSample: 5_000,
      async runIteration() {
        const manager = await getPreparedSnapshotManager();
        const snapshot = manager.getSnapshot();

        if (snapshot.routeCount !== manyRouteCount) {
          throw new Error(
            `Expected ${manyRouteCount} routes in prepared snapshot fixture, observed ${snapshot.routeCount}.`,
          );
        }
      },
    },
  ];
}

let resolverCacheHitStatePromise:
  | Promise<{ sqsResolver: SqsQueueUrlResolver; snsResolver: SnsTopicArnResolver }>
  | undefined;

async function getResolverCacheHitState(): Promise<{
  sqsResolver: SqsQueueUrlResolver;
  snsResolver: SnsTopicArnResolver;
}> {
  resolverCacheHitStatePromise ??= prepareResolverCacheHitState();
  return resolverCacheHitStatePromise;
}

async function prepareResolverCacheHitState(): Promise<{
  sqsResolver: SqsQueueUrlResolver;
  snsResolver: SnsTopicArnResolver;
}> {
  const sqsResolver = new SqsQueueUrlResolver(
    new BenchmarkSqsTransportClient()
      .withQueueUrl('dispatch-queue', createQueueUrl('dispatch-queue'))
      .withQueueUrl('feedback-queue', createQueueUrl('feedback-queue')),
  );
  const snsResolver = new SnsTopicArnResolver(
    new BenchmarkSnsTransportClient()
      .withTopicArn('arn:aws:sns:us-east-1:123456789012:dispatch-events')
      .withTopicArn('arn:aws:sns:us-east-1:123456789012:feedback-events'),
  );

  await sqsResolver.resolve('dispatch-queue');
  await sqsResolver.resolve('feedback-queue');
  await snsResolver.resolve('dispatch-events');
  await snsResolver.resolve('feedback-events');

  return { sqsResolver, snsResolver };
}

let preparedSnapshotManagerPromise: Promise<SqsWorkerManager> | undefined;

async function getPreparedSnapshotManager(): Promise<SqsWorkerManager> {
  preparedSnapshotManagerPromise ??= prepareSnapshotManager();
  return preparedSnapshotManagerPromise;
}

async function prepareSnapshotManager(): Promise<SqsWorkerManager> {
  const queueUrls = Array.from({ length: manyRouteCount }, (_, index) => createQueueUrl(`snapshot-route-${index + 1}`));
  const batchesByQueueUrl = Object.fromEntries(
    queueUrls.map((queueUrl, index) => [
      queueUrl,
      [{ Messages: createBenchmarkMessages(1, JSON.stringify({ routeId: index + 1 })) }],
    ]),
  );
  const manager = new SqsWorkerManager(new BenchmarkMultiRouteWorkerRuntimeClient(batchesByQueueUrl), {
    defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 1 },
  });

  for (const [index, queueUrl] of queueUrls.entries()) {
    manager.register({ name: `snapshot-route-${index + 1}`, queueUrl, handle: async () => undefined });
  }

  await runManagedBenchmarkScenario(manager, async () => {
    await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === manyRouteCount, { timeoutMs: 5_000 });
  });

  assertPreparedSnapshotManager(manager.getSnapshot());
  return manager;
}

function assertPreparedSnapshotManager(snapshot: SqsWorkerManagerSnapshot): void {
  if (snapshot.routeCount !== manyRouteCount) {
    throw new Error(
      `Expected prepared snapshot fixture to have ${manyRouteCount} routes, observed ${snapshot.routeCount}.`,
    );
  }

  if (snapshot.counters.messageDeleteCount !== manyRouteCount) {
    throw new Error(
      `Expected prepared snapshot fixture to delete ${manyRouteCount} messages, observed ${snapshot.counters.messageDeleteCount}.`,
    );
  }
}
