import { SnsTopicArnResolver, SqsQueueUrlResolver } from '../../../src/index';
import {
  type BenchmarkScenario,
  BenchmarkSnsTransportClient,
  BenchmarkSqsTransportClient,
  createQueueUrl,
} from '../support';
import { getResolverCacheHitState } from './fixtures';

export function createResolverBenchmarkScenarios(): BenchmarkScenario[] {
  return [
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
  ];
}
