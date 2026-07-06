import {
  assertNonEmptyIdentifier,
  assertNonEmptyText,
  assertSnsTopicArn,
  assertSqsQueueUrl,
  createSqsQueueNameCacheKey,
  extractAccountIdFromSqsQueueUrl,
  extractNameFromArn,
  extractNameFromUrl,
  isArnForService,
  isHttpUrl,
  normalizeSqsQueueDiscoveryPageSize,
  normalizeSqsQueueResolutionInput,
  SNS_ARN_SERVICE,
  SQS_ARN_SERVICE,
} from './shared';
import type {
  ListSnsTopicsInput,
  ListSnsTopicsResult,
  ListSqsQueuesInput,
  ListSqsQueuesResult,
  SnsTopicArnResolverClient,
  SnsTopicArnResolverOptions,
  SqsQueueDiscoveryClient,
  SqsQueueResolutionInput,
  SqsQueueUrlResolverClient,
  SqsQueueUrlResolverOptions,
} from './types';

export class SqsQueueUrlResolver {
  private readonly identifierCache = new Map<string, string>();
  private readonly queueNameCache = new Map<string, string>();
  private readonly allowNetworkLookup: boolean;

  constructor(
    private readonly client: SqsQueueUrlResolverClient,
    options: SqsQueueUrlResolverOptions = {},
  ) {
    this.allowNetworkLookup = options.allowNetworkLookup ?? true;
    this.seedPreload(options.preload ?? {});
    this.seedPreloadEntries(options.preloadEntries ?? []);
  }

  async resolve(queue: string): Promise<string>;
  async resolve(input: SqsQueueResolutionInput): Promise<string>;
  async resolve(input: string | SqsQueueResolutionInput): Promise<string> {
    const resolution = normalizeSqsQueueResolutionInput(input);
    const cached = this.identifierCache.get(resolution.identifierCacheKey);
    if (cached) {
      return cached;
    }

    if (resolution.directQueueUrl) {
      this.cacheResolution(resolution, resolution.directQueueUrl);
      return resolution.directQueueUrl;
    }

    const namedCacheHit = this.queueNameCache.get(resolution.queueNameCacheKey);
    if (namedCacheHit) {
      this.cacheResolution(resolution, namedCacheHit);
      return namedCacheHit;
    }

    if (!this.allowNetworkLookup) {
      throw new Error(
        `SQS queue "${resolution.queueIdentifier}" was not found in preloaded mappings and network lookup is disabled.`,
      );
    }

    const response = await this.client.getQueueUrl({
      QueueName: resolution.queueName,
      QueueOwnerAWSAccountId: resolution.ownerAccountId,
    });
    const queueUrl = assertNonEmptyText(response.QueueUrl, `resolved queue URL for ${resolution.queueName}`);
    this.cacheResolution(resolution, queueUrl);
    return queueUrl;
  }

  private cacheResolution(resolution: ReturnType<typeof normalizeSqsQueueResolutionInput>, queueUrl: string): void {
    this.identifierCache.set(resolution.identifierCacheKey, queueUrl);
    this.identifierCache.set(queueUrl, queueUrl);
    if (resolution.cacheUnnamedQueueName) {
      this.queueNameCache.set(createSqsQueueNameCacheKey(resolution.queueName), queueUrl);
    }

    const derivedOwnerAccountId = resolution.ownerAccountId ?? extractAccountIdFromSqsQueueUrl(queueUrl);
    if (derivedOwnerAccountId) {
      this.queueNameCache.set(createSqsQueueNameCacheKey(resolution.queueName, derivedOwnerAccountId), queueUrl);
    }
  }

  private seedPreload(preload: Record<string, string>): void {
    for (const [identifier, resolvedQueueUrl] of Object.entries(preload)) {
      const normalizedIdentifier = assertNonEmptyIdentifier(identifier, 'preloaded SQS queue identifier');
      const queueUrl = assertSqsQueueUrl(resolvedQueueUrl, `preloaded SQS queue URL for ${normalizedIdentifier}`);
      const queueName = isHttpUrl(normalizedIdentifier)
        ? extractNameFromUrl(normalizedIdentifier, 'preloaded SQS queue URL')
        : isArnForService(normalizedIdentifier, SQS_ARN_SERVICE)
          ? extractNameFromArn(normalizedIdentifier, SQS_ARN_SERVICE, 'preloaded SQS queue ARN')
          : normalizedIdentifier;
      this.identifierCache.set(normalizedIdentifier, queueUrl);
      this.identifierCache.set(queueName, queueUrl);
      this.identifierCache.set(queueUrl, queueUrl);
      this.queueNameCache.set(createSqsQueueNameCacheKey(queueName), queueUrl);

      const derivedOwnerAccountId = extractAccountIdFromSqsQueueUrl(queueUrl);
      if (derivedOwnerAccountId) {
        this.queueNameCache.set(createSqsQueueNameCacheKey(queueName, derivedOwnerAccountId), queueUrl);
      }
    }
  }

  private seedPreloadEntries(preloadEntries: NonNullable<SqsQueueUrlResolverOptions['preloadEntries']>): void {
    for (const preloadEntry of preloadEntries) {
      const queueUrl = assertSqsQueueUrl(preloadEntry.queueUrl, 'preloaded SQS queue URL');
      const resolution = normalizeSqsQueueResolutionInput({
        queue: preloadEntry.queue,
        ownerAccountId: preloadEntry.ownerAccountId,
      });
      this.cacheResolution(resolution, queueUrl);
    }
  }
}

export class SnsTopicArnResolver {
  private readonly identifierCache = new Map<string, string>();
  private readonly topicNameCache = new Map<string, string>();
  private readonly allowNetworkLookup: boolean;

  constructor(
    private readonly client: SnsTopicArnResolverClient,
    options: SnsTopicArnResolverOptions = {},
  ) {
    this.allowNetworkLookup = options.allowNetworkLookup ?? true;
    this.seedPreload(options.preload ?? {});
  }

  async resolve(topic: string): Promise<string> {
    const topicIdentifier = assertNonEmptyIdentifier(topic, 'SNS topic identifier');
    const cached = this.identifierCache.get(topicIdentifier);
    if (cached) {
      return cached;
    }

    if (isArnForService(topicIdentifier, SNS_ARN_SERVICE)) {
      const topicName = extractNameFromArn(topicIdentifier, SNS_ARN_SERVICE, 'SNS topic ARN');
      this.cacheResolution(topicIdentifier, topicName, topicIdentifier);
      return topicIdentifier;
    }

    const namedCacheHit = this.topicNameCache.get(topicIdentifier);
    if (namedCacheHit) {
      this.cacheResolution(topicIdentifier, topicIdentifier, namedCacheHit);
      return namedCacheHit;
    }

    if (!this.allowNetworkLookup) {
      throw new Error(
        `SNS topic "${topicIdentifier}" was not found in preloaded mappings and network lookup is disabled.`,
      );
    }

    let nextToken: string | undefined;
    do {
      const response = await this.client.listTopics({ NextToken: nextToken });
      for (const topicEntry of response.Topics ?? []) {
        if (!topicEntry.TopicArn) {
          continue;
        }

        const currentTopicName = extractNameFromArn(topicEntry.TopicArn, SNS_ARN_SERVICE, 'SNS topic ARN');
        if (currentTopicName !== topicIdentifier) {
          continue;
        }

        this.cacheResolution(topicIdentifier, currentTopicName, topicEntry.TopicArn);
        return topicEntry.TopicArn;
      }
      nextToken = response.NextToken;
    } while (nextToken);

    throw new Error(`SNS topic "${topicIdentifier}" was not found by ListTopics.`);
  }

  private cacheResolution(identifier: string, topicName: string, topicArn: string): void {
    this.identifierCache.set(identifier, topicArn);
    this.identifierCache.set(topicName, topicArn);
    this.identifierCache.set(topicArn, topicArn);
    this.topicNameCache.set(topicName, topicArn);
  }

  private seedPreload(preload: Record<string, string>): void {
    for (const [identifier, resolvedTopicArn] of Object.entries(preload)) {
      const normalizedIdentifier = assertNonEmptyIdentifier(identifier, 'preloaded SNS topic identifier');
      const topicArn = assertSnsTopicArn(resolvedTopicArn, `preloaded SNS topic ARN for ${normalizedIdentifier}`);
      const topicName = extractNameFromArn(topicArn, SNS_ARN_SERVICE, 'preloaded SNS topic ARN');
      this.cacheResolution(normalizedIdentifier, topicName, topicArn);
    }
  }
}

export class SqsQueueDiscovery {
  constructor(private readonly client: SqsQueueDiscoveryClient) {}

  async listQueues(input: ListSqsQueuesInput = {}): Promise<ListSqsQueuesResult> {
    const pageSize = normalizeSqsQueueDiscoveryPageSize(input.pageSize);
    const queueNamePrefix =
      input.namePrefix === undefined ? undefined : assertNonEmptyIdentifier(input.namePrefix, 'SQS queue name prefix');
    const nextToken =
      input.nextToken === undefined ? undefined : assertNonEmptyIdentifier(input.nextToken, 'SQS nextToken');
    const response = await this.client.listQueues({
      QueueNamePrefix: queueNamePrefix,
      MaxResults: pageSize,
      NextToken: nextToken,
    });

    return {
      queues: (response.QueueUrls ?? []).map((queueUrl) => {
        const normalizedQueueUrl = assertSqsQueueUrl(queueUrl, 'discovered SQS queue URL');
        const queueName = extractNameFromUrl(normalizedQueueUrl, 'discovered SQS queue URL');
        return { queueName, queueUrl: normalizedQueueUrl, fifo: queueName.endsWith('.fifo') };
      }),
      nextToken: response.NextToken,
    };
  }
}

export class SnsTopicDiscovery {
  constructor(private readonly client: SnsTopicArnResolverClient) {}

  async listTopics(input: ListSnsTopicsInput = {}): Promise<ListSnsTopicsResult> {
    const nextToken =
      input.nextToken === undefined ? undefined : assertNonEmptyIdentifier(input.nextToken, 'SNS nextToken');
    const response = await this.client.listTopics({ NextToken: nextToken });

    return {
      topics: (response.Topics ?? [])
        .filter((topicEntry): topicEntry is { TopicArn: string } => typeof topicEntry.TopicArn === 'string')
        .map((topicEntry) => {
          const topicArn = assertSnsTopicArn(topicEntry.TopicArn, 'discovered SNS topic ARN');
          const topicName = extractNameFromArn(topicArn, SNS_ARN_SERVICE, 'discovered SNS topic ARN');
          return { topicName, topicArn, fifo: topicName.endsWith('.fifo') };
        }),
      nextToken: response.NextToken,
    };
  }
}
