import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  parseSqsWorkerServiceManifest,
  runSqsWorkerServiceUntilIdle,
  SqsQueueUrlResolver,
  SqsWorkerManager,
  SqsWorkerServiceHost,
  sqsJsonRoute,
} from '@idenstra/messaging-runtime';

type JobMessage = { jobId: string };

const sqsAdapter = new AwsSqsAdapter(new SQSClient({ region: 'us-east-1' }));

export async function runDirectManagerUntilIdle(): Promise<void> {
  const manager = new SqsWorkerManager(sqsAdapter, { finiteRunDefaults: { idleEmptyReceiveWaves: 2 } });

  manager.register(
    sqsJsonRoute<JobMessage>({
      name: 'jobs',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
      handle: async ({ payload }) => {
        await recordJob(payload.jobId);
      },
    }),
  );

  await manager.runUntilIdle();
}

export async function runDirectManagerBoundedMaintenancePass(): Promise<void> {
  const manager = new SqsWorkerManager(sqsAdapter);

  manager.register(
    sqsJsonRoute<JobMessage>({
      name: 'jobs',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
      handle: async ({ payload }) => {
        await recordJob(payload.jobId);
      },
    }),
  );

  await manager.runBounded({ maxHandledMessagesPerRoute: 100, idleEmptyReceiveWaves: 2 });
}

export async function runServiceHostUntilIdle(): Promise<void> {
  const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
    preload: { jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
    allowNetworkLookup: false,
  });

  const host = new SqsWorkerServiceHost({
    client: sqsAdapter,
    queueResolver,
    managerOptions: { finiteRunDefaults: { idleEmptyReceiveWaves: 2 } },
    manifest: parseSqsWorkerServiceManifest({ routes: { jobs: { queue: 'jobs' } } }),
    routes: [
      sqsJsonRoute<JobMessage>({
        name: 'jobs',
        handle: async ({ payload }) => {
          await recordJob(payload.jobId);
        },
      }),
    ],
  });

  await runSqsWorkerServiceUntilIdle(host);
}

async function recordJob(jobId: string): Promise<void> {
  void jobId;
}
