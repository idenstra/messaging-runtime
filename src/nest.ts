import type { LoggerService, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { SqsWorkerLogger } from './core';
import { SqsWorkerManager } from './core';

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
  protected constructor(protected readonly workerManager: SqsWorkerManager) {}

  async onModuleInit(): Promise<void> {
    await this.workerManager.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.workerManager.stop();
  }

  protected snapshotWorkerStatus() {
    return this.workerManager.getStatus();
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable-meta]';
  }
}
