import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSqsAdapter,
  decodeSqsJsonBody,
  parseSqsWorkerServiceManifest,
  SqsQueueUrlResolver,
  SqsWorkerServiceHost,
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
      {
        name: 'jobs',
        decodePayload: ({ body }) => decodeSqsJsonBody<JobPayload>(body),
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
          const job = payload as JobPayload;
          await processJob(job.jobId);
        },
      },
    ],
  });

  await host.start();
  await host.stop();
}

void main();
