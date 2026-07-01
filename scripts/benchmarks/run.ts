import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import type { ReceiveMessageCommandInput, ReceiveMessageCommandOutput } from '@aws-sdk/client-sqs';
import {
  packageMetadata,
  SnsPublisher,
  type SnsTransportClient,
  SqsPublisher,
  type SqsRuntimeClient,
  type SqsRuntimeRequestOptions,
  type SqsTransportClient,
  SqsWorkerManager,
} from '../../src/index';

interface BenchmarkScenario {
  name: string;
  description: string;
  iterationsPerSample: number;
  runIteration(): Promise<void>;
}

interface BenchmarkScenarioResult {
  name: string;
  description: string;
  iterationsPerSample: number;
  sampleDurationsMs: number[];
  meanMsPerIteration: number;
  medianMsPerIteration: number;
  p95MsPerIteration: number;
  minMsPerIteration: number;
  maxMsPerIteration: number;
  opsPerSecond: number;
}

interface BenchmarkReport {
  packageName: string;
  packageVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuModel?: string;
  command: string;
  warmupSamples: number;
  measuredSamples: number;
  scenarios: BenchmarkScenarioResult[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const baselineJsonPath = path.join(repoRoot, 'docs/benchmarks/baseline.json');
const baselineMarkdownPath = path.join(repoRoot, 'docs/benchmarks/baseline.md');
const packageJsonPath = path.join(repoRoot, 'package.json');
const warmupSamples = 1;
const measuredSamples = 3;

class BenchmarkSqsTransportClient implements SqsTransportClient {
  private readonly queueUrls = new Map<string, string>();

  withQueueUrl(queueName: string, queueUrl: string): this {
    this.queueUrls.set(queueName, queueUrl);
    return this;
  }

  async getQueueUrl(input: { QueueName?: string }) {
    return { QueueUrl: input.QueueName ? this.queueUrls.get(input.QueueName) : undefined };
  }

  async sendMessage() {
    return { MessageId: 'message-1', SequenceNumber: '1' };
  }

  async sendMessageBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return {
      Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id, MessageId: `message-${entry.Id}` })),
      Failed: [],
    };
  }

  async deleteMessageBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return { Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id })), Failed: [] };
  }

  async changeMessageVisibilityBatch(input: { Entries?: Array<{ Id?: string }> }) {
    return { Successful: (input.Entries ?? []).map((entry) => ({ Id: entry.Id })), Failed: [] };
  }
}

class BenchmarkSnsTransportClient implements SnsTransportClient {
  async listTopics() {
    return { Topics: [] };
  }

  async publish() {
    return { MessageId: 'sns-message-1', SequenceNumber: '1' };
  }

  async publishBatch(input: { PublishBatchRequestEntries?: Array<{ Id?: string }> }) {
    return {
      Successful: (input.PublishBatchRequestEntries ?? []).map((entry) => ({
        Id: entry.Id,
        MessageId: `sns-message-${entry.Id}`,
        SequenceNumber: '1',
      })),
      Failed: [],
    };
  }
}

interface BenchmarkMessage {
  MessageId: string;
  ReceiptHandle: string;
  Body: string;
}

class BenchmarkWorkerRuntimeClient implements SqsRuntimeClient {
  private readonly batches: Array<{ Messages?: BenchmarkMessage[] }>;

  constructor(batches: Array<{ Messages?: BenchmarkMessage[] }>) {
    this.batches = batches.map((batch) => ({ Messages: batch.Messages?.map((message) => ({ ...message })) }));
  }

  async receiveMessage(
    input: ReceiveMessageCommandInput,
    _options?: SqsRuntimeRequestOptions,
  ): Promise<ReceiveMessageCommandOutput> {
    const next = this.batches.shift();
    if (!next?.Messages?.length) {
      return { Messages: [] };
    }

    const maxMessages = input.MaxNumberOfMessages ?? next.Messages.length;
    const messages = next.Messages.slice(0, maxMessages);
    if (messages.length < next.Messages.length) {
      this.batches.unshift({ Messages: next.Messages.slice(maxMessages) });
    }

    return { Messages: messages };
  }

  async deleteMessage(): Promise<void> {}

  async changeMessageVisibility(): Promise<void> {}
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const packageVersion = await readPackageVersion();
  const scenarios = createBenchmarkScenarios();
  const results: BenchmarkScenarioResult[] = [];

  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const report: BenchmarkReport = {
    packageName: packageMetadata.name,
    packageVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model,
    command: args.has('--json') ? 'npm run benchmark:ci' : 'npm run benchmark',
    warmupSamples,
    measuredSamples,
    scenarios: results,
  };

  if (args.has('--write-baseline')) {
    await fs.mkdir(path.dirname(baselineJsonPath), { recursive: true });
    await fs.writeFile(baselineJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(baselineMarkdownPath, renderMarkdownReport(report));
  }

  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderMarkdownReport(report));
}

function createBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    {
      name: 'publisher:sqs-batch',
      description: 'SQS batch publish chunking and result aggregation.',
      iterationsPerSample: 50,
      async runIteration() {
        const client = new BenchmarkSqsTransportClient().withQueueUrl(
          'jobs',
          'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
        );
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
      name: 'worker:ack-delete',
      description: 'Single-message delete finalization baseline.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([
            { Messages: [{ MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: '{"jobId":"job-1"}' }] },
          ]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 } },
        );

        manager.register({ name: 'jobs', queueUrl: 'https://queue.test/jobs', handle: async () => undefined });

        await manager.start();
        await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 1);
        await manager.stop();
      },
    },
    {
      name: 'worker:visibility-heartbeat',
      description: 'Single-message visibility heartbeat baseline.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([
            { Messages: [{ MessageId: 'message-1', ReceiptHandle: 'receipt-1', Body: '{"jobId":"job-1"}' }] },
          ]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0 } },
        );

        manager.register({
          name: 'jobs',
          queueUrl: 'https://queue.test/jobs',
          handle: async ({ heartbeat }) => {
            await heartbeat();
            return { action: 'keep' };
          },
        });

        await manager.start();
        await waitFor(
          () =>
            manager.getSnapshot().counters.heartbeatSuccessCount === 1 &&
            manager.getSnapshot().counters.messageKeepCount === 1,
        );
        await manager.stop();
      },
    },
    {
      name: 'worker:single-route-full-batch',
      description: 'Current full-batch receive and dispatch baseline.',
      iterationsPerSample: 20,
      async runIteration() {
        const manager = new SqsWorkerManager(
          new BenchmarkWorkerRuntimeClient([
            {
              Messages: Array.from({ length: 10 }, (_, index) => ({
                MessageId: `message-${index}`,
                ReceiptHandle: `receipt-${index}`,
                Body: JSON.stringify({ jobId: `job-${index}` }),
              })),
            },
          ]),
          { defaults: { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, maxMessagesPerPoll: 10 } },
        );

        manager.register({ name: 'jobs', queueUrl: 'https://queue.test/jobs', handle: async () => undefined });

        await manager.start();
        await waitFor(() => manager.getSnapshot().counters.messageDeleteCount === 10);
        await manager.stop();
      },
    },
  ];
}

async function runScenario(scenario: BenchmarkScenario): Promise<BenchmarkScenarioResult> {
  for (let index = 0; index < warmupSamples; index += 1) {
    await runScenarioSample(scenario);
  }

  const sampleDurationsMs: number[] = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    sampleDurationsMs.push(await runScenarioSample(scenario));
  }

  const perIterationDurations = sampleDurationsMs.map((duration) => duration / scenario.iterationsPerSample);

  return {
    name: scenario.name,
    description: scenario.description,
    iterationsPerSample: scenario.iterationsPerSample,
    sampleDurationsMs: sampleDurationsMs.map((duration) => round(duration)),
    meanMsPerIteration: round(mean(perIterationDurations)),
    medianMsPerIteration: round(percentile(perIterationDurations, 0.5)),
    p95MsPerIteration: round(percentile(perIterationDurations, 0.95)),
    minMsPerIteration: round(Math.min(...perIterationDurations)),
    maxMsPerIteration: round(Math.max(...perIterationDurations)),
    opsPerSecond: round(1_000 / mean(perIterationDurations)),
  };
}

async function runScenarioSample(scenario: BenchmarkScenario): Promise<number> {
  const startedAt = performance.now();

  for (let iteration = 0; iteration < scenario.iterationsPerSample; iteration += 1) {
    await scenario.runIteration();
  }

  return performance.now() - startedAt;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(0);
  }

  throw new Error(`Benchmark waitFor timed out after ${timeoutMs}ms.`);
}

async function readPackageVersion(): Promise<string> {
  const rawPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { version: string };
  return rawPackageJson.version;
}

function renderMarkdownReport(report: BenchmarkReport): string {
  const lines = [
    '# Benchmark baseline',
    '',
    `Package: \`${report.packageName}@${report.packageVersion}\``,
    `Node: \`${report.nodeVersion}\``,
    `Platform: \`${report.platform}/${report.arch}\``,
    report.cpuModel ? `CPU: \`${report.cpuModel}\`` : undefined,
    `Command: \`${report.command}\``,
    `Warmup samples: \`${report.warmupSamples}\``,
    `Measured samples: \`${report.measuredSamples}\``,
    '',
    '| Scenario | Description | Iterations/sample | Median ms/iteration | P95 ms/iteration | Ops/sec |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.scenarios.map(
      (scenario) =>
        `| \`${scenario.name}\` | ${scenario.description} | ${scenario.iterationsPerSample} | ${scenario.medianMsPerIteration.toFixed(4)} | ${scenario.p95MsPerIteration.toFixed(4)} | ${scenario.opsPerSecond.toFixed(2)} |`,
    ),
    '',
    'These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.',
    '',
  ].filter((line): line is string => line !== undefined);

  return `${lines.join('\n')}\n`;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${inspect(error)}\n`);
  process.exitCode = 1;
});
