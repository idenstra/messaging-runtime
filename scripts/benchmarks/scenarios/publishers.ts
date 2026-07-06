import { SnsPublisher, SqsPublisher } from '../../../src/index';
import {
  type BenchmarkScenario,
  BenchmarkSnsTransportClient,
  BenchmarkSqsTransportClient,
  createQueueUrl,
} from '../support';

export function createPublisherBenchmarkScenarios(): BenchmarkScenario[] {
  return [
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
  ];
}
