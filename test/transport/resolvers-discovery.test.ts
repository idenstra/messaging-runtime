import assert from 'node:assert/strict';
import test from 'node:test';
import { SnsTopicArnResolver, SnsTopicDiscovery, SqsQueueDiscovery, SqsQueueUrlResolver } from '../../src';
import { FakeSnsTransportClient, FakeSqsTransportClient } from './support';

test('SqsQueueUrlResolver resolves queue names with caching and accepts URLs and ARNs', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const resolver = new SqsQueueUrlResolver(client);

  const resolvedByName = await resolver.resolve('dispatch-queue');
  const resolvedByNameAgain = await resolver.resolve('dispatch-queue');
  const resolvedByUrl = await resolver.resolve('https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  const resolvedByArn = await resolver.resolve('arn:aws:sqs:us-east-1:123456789012:dispatch-queue');

  assert.equal(resolvedByName, 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  assert.equal(resolvedByNameAgain, resolvedByName);
  assert.equal(resolvedByUrl, resolvedByName);
  assert.equal(resolvedByArn, resolvedByName);
  assert.equal(client.getQueueUrlInputs.length, 1);
});

test('SqsQueueUrlResolver supports preloaded mappings and optional no-network mode', async () => {
  const client = new FakeSqsTransportClient();
  const resolver = new SqsQueueUrlResolver(client, {
    preload: {
      'dispatch-queue': 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
      'arn:aws:sqs:us-east-1:123456789012:audit-queue': 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-queue',
    },
    allowNetworkLookup: false,
  });

  assert.equal(
    await resolver.resolve('dispatch-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  assert.equal(
    await resolver.resolve('https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  assert.equal(
    await resolver.resolve('arn:aws:sqs:us-east-1:123456789012:audit-queue'),
    'https://sqs.us-east-1.amazonaws.com/123456789012/audit-queue',
  );
  assert.equal(client.getQueueUrlInputs.length, 0);
  await assert.rejects(() => resolver.resolve('missing-queue'), /network lookup is disabled/i);
});

test('SqsQueueUrlResolver supports typed cross-account resolution without cache collisions', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/210987654321/dispatch-queue', '210987654321');
  const resolver = new SqsQueueUrlResolver(client);

  const defaultResolvedQueue = await resolver.resolve('dispatch-queue');
  const crossAccountResolvedQueue = await resolver.resolve({ queue: 'dispatch-queue', ownerAccountId: '210987654321' });
  const crossAccountResolvedQueueAgain = await resolver.resolve({
    queue: 'dispatch-queue',
    ownerAccountId: '210987654321',
  });
  const resolvedByArn = await resolver.resolve('arn:aws:sqs:us-east-1:210987654321:dispatch-queue');

  assert.equal(defaultResolvedQueue, 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  assert.equal(crossAccountResolvedQueue, 'https://sqs.us-east-1.amazonaws.com/210987654321/dispatch-queue');
  assert.equal(crossAccountResolvedQueueAgain, crossAccountResolvedQueue);
  assert.equal(resolvedByArn, crossAccountResolvedQueue);
  assert.deepEqual(client.getQueueUrlInputs, [
    { QueueName: 'dispatch-queue', QueueOwnerAWSAccountId: undefined },
    { QueueName: 'dispatch-queue', QueueOwnerAWSAccountId: '210987654321' },
  ]);
});

test('SqsQueueUrlResolver supports typed preload entries and validates owner-account usage', async () => {
  const client = new FakeSqsTransportClient();
  const resolver = new SqsQueueUrlResolver(client, {
    preloadEntries: [
      {
        queue: 'dispatch-queue',
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/210987654321/dispatch-queue',
        ownerAccountId: '210987654321',
      },
    ],
    allowNetworkLookup: false,
  });

  assert.equal(
    await resolver.resolve({ queue: 'dispatch-queue', ownerAccountId: '210987654321' }),
    'https://sqs.us-east-1.amazonaws.com/210987654321/dispatch-queue',
  );
  assert.equal(client.getQueueUrlInputs.length, 0);
  await assert.rejects(
    () => resolver.resolve({ queue: 'dispatch-queue', ownerAccountId: 'abc' }),
    /12-digit AWS account ID/i,
  );
  await assert.rejects(
    () => resolver.resolve({ queue: 'dispatch-queue', ownerAccountId: 123 as unknown as string }),
    /must be a non-empty string/i,
  );
  await assert.rejects(
    () =>
      resolver.resolve({ queue: 'arn:aws:sqs:us-east-1:210987654321:dispatch-queue', ownerAccountId: '210987654321' }),
    /only supported when resolving a queue by name/i,
  );
});

test('SnsTopicArnResolver resolves topic names with pagination, accepts ARNs, and caches results', async () => {
  const client = new FakeSnsTransportClient()
    .withListTopicsResponse({
      NextToken: 'page-2',
      Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:other-topic' }],
    })
    .withListTopicsResponse({ Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events' }] });
  const resolver = new SnsTopicArnResolver(client);

  const resolvedByName = await resolver.resolve('example-email-events');
  const resolvedByArn = await resolver.resolve('arn:aws:sns:us-east-1:123456789012:example-email-events');
  const resolvedByNameAgain = await resolver.resolve('example-email-events');

  assert.equal(resolvedByName, 'arn:aws:sns:us-east-1:123456789012:example-email-events');
  assert.equal(resolvedByArn, resolvedByName);
  assert.equal(resolvedByNameAgain, resolvedByName);
  assert.deepEqual(client.listTopicsInputs, [{ NextToken: undefined }, { NextToken: 'page-2' }]);
});

test('SnsTopicArnResolver rejects SNS subscription ARNs when a topic ARN is required', async () => {
  const resolver = new SnsTopicArnResolver(new FakeSnsTransportClient());

  await assert.rejects(
    () =>
      resolver.resolve('arn:aws:sns:us-east-1:123456789012:example-email-events:4f9b7784-0c5d-4b5a-8ba7-54c2f4b15540'),
    /SNS topic ARN/i,
  );
});

test('SnsTopicArnResolver supports preloaded mappings and optional no-network mode', async () => {
  const client = new FakeSnsTransportClient();
  const resolver = new SnsTopicArnResolver(client, {
    preload: {
      'example-email-events': 'arn:aws:sns:us-east-1:123456789012:example-email-events',
      'arn:aws:sns:us-east-1:123456789012:tenant-events': 'arn:aws:sns:us-east-1:123456789012:tenant-events',
    },
    allowNetworkLookup: false,
  });

  assert.equal(
    await resolver.resolve('example-email-events'),
    'arn:aws:sns:us-east-1:123456789012:example-email-events',
  );
  assert.equal(
    await resolver.resolve('arn:aws:sns:us-east-1:123456789012:tenant-events'),
    'arn:aws:sns:us-east-1:123456789012:tenant-events',
  );
  assert.equal(client.listTopicsInputs.length, 0);
  await assert.rejects(() => resolver.resolve('missing-topic'), /network lookup is disabled/i);
});

test('SnsTopicArnResolver fails cleanly when a topic name cannot be found', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({ Topics: [] });
  const resolver = new SnsTopicArnResolver(client);

  await assert.rejects(() => resolver.resolve('missing-topic'), /missing-topic.*not found/i);
});

test('SqsQueueDiscovery lists page-first queue summaries with prefix forwarding', async () => {
  const client = new FakeSqsTransportClient().withListQueuesResponse({
    QueueUrls: [
      'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
      'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-dlq.fifo',
    ],
    NextToken: 'page-2',
  });
  const discovery = new SqsQueueDiscovery(client);

  const result = await discovery.listQueues({ namePrefix: 'jobs', pageSize: 2, nextToken: 'page-1' });

  assert.deepEqual(client.listQueuesInputs, [{ QueueNamePrefix: 'jobs', MaxResults: 2, NextToken: 'page-1' }]);
  assert.deepEqual(result, {
    queues: [
      { queueName: 'jobs', queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs', fifo: false },
      {
        queueName: 'jobs-dlq.fifo',
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs-dlq.fifo',
        fifo: true,
      },
    ],
    nextToken: 'page-2',
  });
});

test('SnsTopicDiscovery lists page-first topic summaries', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [
      { TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events' },
      { TopicArn: 'arn:aws:sns:us-east-1:123456789012:jobs.fifo' },
    ],
    NextToken: 'page-2',
  });
  const discovery = new SnsTopicDiscovery(client);

  const result = await discovery.listTopics({ nextToken: 'page-1' });

  assert.deepEqual(client.listTopicsInputs, [{ NextToken: 'page-1' }]);
  assert.deepEqual(result, {
    topics: [
      {
        topicName: 'example-email-events',
        topicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
        fifo: false,
      },
      { topicName: 'jobs.fifo', topicArn: 'arn:aws:sns:us-east-1:123456789012:jobs.fifo', fifo: true },
    ],
    nextToken: 'page-2',
  });
});
