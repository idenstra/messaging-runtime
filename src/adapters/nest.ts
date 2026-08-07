import type { LoggerService, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { SqsWorkerLogger } from '../core';
import type { SqsWorkerServiceLifecycle } from '../host';

export type {
  SqsWorkerBufferedMessageDropReason,
  SqsWorkerFailureKind,
  SqsWorkerFiniteRunLifecycle,
  SqsWorkerLateSettlementOutcome,
  SqsWorkerLogger,
  SqsWorkerManagerSnapshot,
  SqsWorkerRouteCounters,
  SqsWorkerRouteStatus,
} from '../core';
export type { SqsWorkerServiceLifecycle } from '../host';

export class NestSqsWorkerLoggerAdapter implements SqsWorkerLogger {
  constructor(private readonly logger: LoggerService) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (typeof this.logger.debug === 'function') {
      this.logger.debug(this.format(message, meta));
      return;
    }
    this.logger.log(this.format(message, meta));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.log(this.format(message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(this.format(message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(this.format(message, meta));
  }

  private format(message: string, meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) {
      return message;
    }

    return `${message} ${safeStringify(meta)}`;
  }
}

export abstract class AbstractNestSqsWorkerHost implements OnModuleInit, OnModuleDestroy {
  protected constructor(protected readonly workerLifecycle: SqsWorkerServiceLifecycle) {}

  async onModuleInit(): Promise<void> {
    await this.workerLifecycle.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.workerLifecycle.stop();
  }

  protected snapshotWorkerStatus() {
    return this.workerLifecycle.getStatus();
  }

  protected snapshotWorkerSnapshot() {
    return this.workerLifecycle.getSnapshot();
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable-meta]';
  }
}
