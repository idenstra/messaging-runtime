import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { LoggerService } from '@nestjs/common';
import {
  parseSqsWorkerServiceManifest,
  type SqsRuntimeClient,
  SqsWorkerManager,
  SqsWorkerServiceHost,
} from '../../src';
import { AbstractNestSqsWorkerHost, NestSqsWorkerLoggerAdapter } from '../../src/adapters/nest';

class FakeSqsClient implements SqsRuntimeClient {
  async receiveMessage() {
    return { Messages: [] };
  }

  async deleteMessage(): Promise<void> {}

  async deleteMessageBatch() {
    return { Successful: [], Failed: [] };
  }

  async changeMessageVisibility(): Promise<void> {}
}

class FakeQueueResolver {
  constructor(private readonly bindings: Record<string, string>) {}

  async resolve(queue: string): Promise<string> {
    const queueUrl = this.bindings[queue];
    if (!queueUrl) {
      throw new Error(`No queue URL bound for ${queue}.`);
    }
    return queueUrl;
  }
}

class Host extends AbstractNestSqsWorkerHost {
  status() {
    return this.snapshotWorkerStatus();
  }

  snapshot() {
    return this.snapshotWorkerSnapshot();
  }
}

test('nest host starts and stops the underlying manager lifecycle', async () => {
  const manager = new SqsWorkerManager(new FakeSqsClient());
  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
    config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
  });

  const host = new Host(manager);
  await host.onModuleInit();
  assert.equal(host.status()[0]?.running, true);
  await host.onModuleDestroy();
  assert.equal(host.status()[0]?.running, false);
});

test('nest host also works with the higher-level worker service host', async () => {
  const serviceHost = new SqsWorkerServiceHost({
    client: new FakeSqsClient(),
    queueResolver: new FakeQueueResolver({ 'dispatch-queue': 'https://queue.test/email' }),
    routes: [
      {
        name: 'dispatch-email',
        queue: 'dispatch-queue',
        handle: async () => undefined,
        config: { waitTimeSeconds: 0, emptyReceiveDelayMs: 10, heartbeatIntervalMs: 0 },
      },
    ],
    manifest: parseSqsWorkerServiceManifest({ routes: { 'dispatch-email': {} } }),
  });

  const host = new Host(serviceHost);
  await host.onModuleInit();
  assert.equal(host.status()[0]?.running, true);
  assert.equal(host.snapshot().routeCount, 1);
  await host.onModuleDestroy();
  assert.equal(host.status()[0]?.running, false);
});

test('nest logger adapter tolerates unserializable metadata', () => {
  const messages: string[] = [];
  const logger: LoggerService = {
    log(message: unknown) {
      messages.push(String(message));
    },
    error(message: unknown) {
      messages.push(String(message));
    },
    warn(message: unknown) {
      messages.push(String(message));
    },
    debug(message: unknown) {
      messages.push(String(message));
    },
  };
  const adapter = new NestSqsWorkerLoggerAdapter(logger);
  const meta: Record<string, unknown> = {};
  meta.self = meta;

  adapter.info('worker event', meta);

  assert.equal(messages[0], 'worker event [unserializable-meta]');
});
