import { SQSClient } from '@aws-sdk/client-sqs';
import { AwsSqsAdapter, SqsWorkerManager, sqsJsonRoute } from '@idenstra/messaging-runtime';

type JobPayload = { jobId: string };

class FakePool {
  async connect(): Promise<void> {}

  async close(): Promise<void> {}
}

async function processJob(jobId: string): Promise<void> {
  void jobId;
}

function markShutdownRequested(): void {}

const awsSqs = new SQSClient({ region: 'us-east-1' });
const sqsAdapter = new AwsSqsAdapter(awsSqs);
const pool = new FakePool();

async function main(): Promise<void> {
  const manager = new SqsWorkerManager(sqsAdapter, { defaults: { waitTimeSeconds: 20, visibilityTimeoutSeconds: 60 } });

  manager.register(
    sqsJsonRoute<JobPayload>({
      name: 'jobs',
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
      lifecycle: {
        beforeStart: async () => {
          await pool.connect();
        },
        beforeStop: () => {
          markShutdownRequested();
        },
        afterStop: async () => {
          await pool.close();
        },
      },
      handle: async ({ payload }) => {
        await processJob(payload.jobId);
      },
    }),
  );

  await manager.start();
  await manager.stop();
}

void main();
