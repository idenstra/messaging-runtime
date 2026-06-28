import { strict as assert } from 'node:assert';
import test from 'node:test';
import { AbstractNestSqsWorkerHost, SqsWorkerManager, type SqsRuntimeClient } from '../src';

class FakeSqsClient implements SqsRuntimeClient {
  async receiveMessage() {
    return { Messages: [] };
  }

  async deleteMessage(): Promise<void> {}

  async changeMessageVisibility(): Promise<void> {}
}

class Host extends AbstractNestSqsWorkerHost {
  constructor(manager: SqsWorkerManager) {
    super(manager);
  }

  status() {
    return this.snapshotWorkerStatus();
  }
}

test('nest host starts and stops the underlying manager lifecycle', async () => {
  const manager = new SqsWorkerManager(new FakeSqsClient());
  manager.register({
    name: 'dispatch-email',
    queueUrl: 'https://queue.test/email',
    handle: async () => undefined,
    config: {
      waitTimeSeconds: 0,
      emptyReceiveDelayMs: 10,
      heartbeatIntervalMs: 0,
    },
  });

  const host = new Host(manager);
  await host.onModuleInit();
  assert.equal(host.status()[0]?.running, true);
  await host.onModuleDestroy();
  assert.equal(host.status()[0]?.running, false);
});
