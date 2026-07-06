import { decodeSnsNotificationJson, decodeSqsJsonBody } from '../../../src/index';
import { type BenchmarkScenario, benchmarkSnsNotificationEnvelopeBody, benchmarkSqsJsonBody } from '../support';

export function createDecodeBenchmarkScenarios(): BenchmarkScenario[] {
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
  ];
}
