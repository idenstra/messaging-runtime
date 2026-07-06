import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  parseSqsWorkerServiceManifest,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
  sqsJsonRoute,
} from '@idenstra/messaging-runtime';

type JobPayload = { jobId: string };

class FakeHttpClient {
  async close(): Promise<void> {}
}

async function processJob(jobId: string): Promise<void> {
  void jobId;
}

function markWorkerReady(): void {}

function markShutdownRequested(): void {}

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const queueResolver = new SqsQueueUrlResolver(sqsAdapter, {
  preload: { jobs: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
  allowNetworkLookup: false,
});
const httpClient = new FakeHttpClient();

const manifest = parseSqsWorkerServiceManifest({ routes: { jobs: { queue: 'jobs' } } });

async function main(): Promise<void> {
  const host = new SqsWorkerServiceHost({
    client: sqsAdapter,
    queueResolver,
    manifest,
    routes: [
      sqsJsonRoute<JobPayload>({
        name: 'jobs',
        lifecycle: {
          afterStart: () => {
            markWorkerReady();
          },
          beforeStop: () => {
            markShutdownRequested();
          },
          afterStop: async () => {
            await httpClient.close();
          },
        },
        handle: async ({ payload }) => {
          await processJob(payload.jobId);
        },
      }),
    ],
  });

  await host.start();
  await host.stop();
}

void main();
