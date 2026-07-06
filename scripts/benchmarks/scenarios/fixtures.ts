import type { SqsWorkerManagerSnapshot } from '../../../src/index';
import { SnsTopicArnResolver, SqsQueueUrlResolver, SqsWorkerManager } from '../../../src/index';
import {
  BenchmarkMultiRouteWorkerRuntimeClient,
  BenchmarkSnsTransportClient,
  BenchmarkSqsTransportClient,
  createBenchmarkMessages,
  createQueueUrl,
  runManagedBenchmarkScenario,
  waitFor,
} from '../support';

export const manyRouteCount = 32;

let resolverCacheHitStatePromise:
  | Promise<{ sqsResolver: SqsQueueUrlResolver; snsResolver: SnsTopicArnResolver }>
  | undefined;

export async function getResolverCacheHitState(): Promise<{
  sqsResolver: SqsQueueUrlResolver;
  snsResolver: SnsTopicArnResolver;
}> {
  resolverCacheHitStatePromise ??= prepareResolverCacheHitState();
  return resolverCacheHitStatePromise;
}

let preparedSnapshotManagerPromise: Promise<SqsWorkerManager> | undefined;

export async function getPreparedSnapshotManager(): Promise<SqsWorkerManager> {
  preparedSnapshotManagerPromise ??= prepareSnapshotManager();
  return preparedSnapshotManagerPromise;
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
