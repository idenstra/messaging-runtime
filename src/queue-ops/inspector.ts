import { SqsQueueUrlResolver, type SqsQueueUrlResolverClient } from '../transport';
import {
  assertNonEmptyIdentifier,
  buildQueueDescription,
  buildQueueInspectionAttributeNames,
  normalizeDeadLetterSourcePageSize,
} from './shared';
import type { SqsDeadLetterSourceQueuesResult, SqsQueueDescription, SqsQueueOperationsClient } from './types';

export interface SqsQueueInspectorOptions {
  queueResolver?: SqsQueueUrlResolver;
}

export class SqsQueueInspector {
  private readonly resolver: SqsQueueUrlResolver;

  constructor(
    private readonly client: SqsQueueOperationsClient & SqsQueueUrlResolverClient,
    options: SqsQueueInspectorOptions = {},
  ) {
    this.resolver = options.queueResolver ?? new SqsQueueUrlResolver(client);
  }

  async inspectQueue(queue: string): Promise<SqsQueueDescription> {
    const queueIdentifier = assertNonEmptyIdentifier(queue, 'SQS queue identifier');
    const queueUrl = await this.resolver.resolve(queueIdentifier);
    const response = await this.client.getQueueAttributes({
      QueueUrl: queueUrl,
      AttributeNames: buildQueueInspectionAttributeNames(queueUrl),
    });
    const attributes = { ...(response.Attributes ?? {}) };

    return buildQueueDescription({ queueIdentifier, queueUrl, attributes });
  }

  async listDeadLetterSourceQueues(
    queue: string,
    options: { pageSize?: number } = {},
  ): Promise<SqsDeadLetterSourceQueuesResult> {
    const description = await this.inspectQueue(queue);
    const pageSize = normalizeDeadLetterSourcePageSize(options.pageSize);
    const sourceQueueUrls: string[] = [];
    let nextToken: string | undefined;

    do {
      const response = await this.client.listDeadLetterSourceQueues({
        QueueUrl: description.queueUrl,
        MaxResults: pageSize,
        NextToken: nextToken,
      });
      sourceQueueUrls.push(...(response.queueUrls ?? []));
      nextToken = response.NextToken;
    } while (nextToken);

    return {
      queueIdentifier: description.queueIdentifier,
      queueUrl: description.queueUrl,
      queueArn: description.queueArn,
      sourceQueueUrls,
    };
  }
}
