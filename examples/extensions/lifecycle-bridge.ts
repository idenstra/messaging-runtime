import type { SqsWorkerManagerSnapshot, SqsWorkerServiceLifecycle } from '@idenstra/messaging-runtime';

interface AppRuntimeLifecycle {
  onStart(callback: () => Promise<void>): void;
  onStop(callback: () => Promise<void>): void;
}

class WorkerLifecycleBridge {
  constructor(private readonly worker: SqsWorkerServiceLifecycle) {}

  async start(): Promise<void> {
    await this.worker.start();
  }

  async stop(): Promise<void> {
    await this.worker.stop();
  }

  snapshot(): SqsWorkerManagerSnapshot {
    return this.worker.getSnapshot();
  }

  isReady(): boolean {
    const snapshot = this.snapshot();
    return snapshot.started && !snapshot.stopping;
  }
}

function bindWorkerToRuntime(runtime: AppRuntimeLifecycle, worker: SqsWorkerServiceLifecycle): WorkerLifecycleBridge {
  const bridge = new WorkerLifecycleBridge(worker);

  runtime.onStart(async () => {
    await bridge.start();
  });

  runtime.onStop(async () => {
    await bridge.stop();
  });

  return bridge;
}

declare const runtime: AppRuntimeLifecycle;
declare const workerHost: SqsWorkerServiceLifecycle;

const bridge = bindWorkerToRuntime(runtime, workerHost);

void bridge;
