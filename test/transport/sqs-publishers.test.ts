import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessageAttributeValue as SqsMessageAttributeValue } from '@aws-sdk/client-sqs';
import { SqsPublisher } from '../../src';
import { FakeSqsTransportClient } from './support';

test('SqsPublisher sendJson resolves queue identifiers and forwards transport-native options', async () => {
  const attribute: SqsMessageAttributeValue = { DataType: 'String', StringValue: 'alpha' };
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
    '123456789012',
  );
  const publisher = new SqsPublisher(client);

  const result = await publisher.sendJson({
    queue: 'arn:aws:sqs:us-east-1:123456789012:dispatch-queue',
    payload: { kind: 'dispatch' },
    delaySeconds: 5,
    messageAttributes: { mode: attribute },
    messageGroupId: 'group-1',
    messageDeduplicationId: 'dedupe-1',
  });

  assert.equal(result.queueUrl, 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue');
  assert.equal(client.getQueueUrlInputs.length, 1);
  assert.deepEqual(client.sendMessageInputs[0], {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
    MessageBody: JSON.stringify({ kind: 'dispatch' }),
    DelaySeconds: 5,
    MessageAttributes: { mode: attribute },
    MessageGroupId: 'group-1',
    MessageDeduplicationId: 'dedupe-1',
  });
});

test('SqsPublisher sendString and sendSerialized publish explicit string bodies', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const publisher = new SqsPublisher(client);

  await publisher.sendString({ queue: 'dispatch-queue', body: 'plain text body' });
  await publisher.sendSerialized({
    queue: 'dispatch-queue',
    payload: { jobId: 'job-1' },
    serialize: (payload) => `job:${payload.jobId}`,
  });

  assert.equal(client.sendMessageInputs[0]?.MessageBody, 'plain text body');
  assert.equal(client.sendMessageInputs[1]?.MessageBody, 'job:job-1');
});

test('SqsPublisher sendJsonBatch chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withBatchResponse({
      Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}`, MessageId: `message-${index}` })),
    })
    .withBatchResponse({
      Successful: [{ Id: 'entry-10', MessageId: 'message-10' }],
      Failed: [{ Id: 'entry-11', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const publisher = new SqsPublisher(client);

  const result = await publisher.sendJsonBatch({
    queue: 'dispatch-queue',
    entries: Array.from({ length: 12 }, (_, index) => ({ id: `job-${index}`, payload: { index } })),
  });

  assert.equal(client.sendMessageBatchInputs.length, 2);
  assert.equal(client.sendMessageBatchInputs[0]?.Entries?.length, 10);
  assert.equal(client.sendMessageBatchInputs[1]?.Entries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.equal(result.successfulById['job-0']?.messageId, 'message-0');
  assert.equal(result.successfulById['job-10']?.messageId, 'message-10');
  assert.equal(result.failedById['job-11']?.code, 'InternalError');
});

test('SqsPublisher sendStringBatch and sendSerializedBatch preserve chunking and keyed failures', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withBatchResponse({
      Successful: [{ Id: 'entry-0', MessageId: 'message-0' }],
      Failed: [{ Id: 'entry-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    })
    .withBatchResponse({ Successful: [{ Id: 'entry-0', MessageId: 'message-2' }] });
  const publisher = new SqsPublisher(client);

  const stringResult = await publisher.sendStringBatch({
    queue: 'dispatch-queue',
    entries: [
      { id: 'job-0', body: 'body-0' },
      { id: 'job-1', body: 'body-1' },
    ],
  });
  const serializedResult = await publisher.sendSerializedBatch({
    queue: 'dispatch-queue',
    serialize: (payload: { index: number }) => `payload:${payload.index}`,
    entries: [{ id: 'job-2', payload: { index: 2 } }],
  });

  assert.equal(client.sendMessageBatchInputs[0]?.Entries?.[0]?.MessageBody, 'body-0');
  assert.equal(client.sendMessageBatchInputs[1]?.Entries?.[0]?.MessageBody, 'payload:2');
  assert.equal(stringResult.failedById['job-1']?.code, 'InternalError');
  assert.equal(serializedResult.successfulById['job-2']?.messageId, 'message-2');
});

test('SqsPublisher size validation supports constructor defaults, per-call override, disable, and batch entry failures', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const publisher = new SqsPublisher(client, undefined, { sizeValidation: { maxBytes: 24 } });

  await assert.rejects(
    () => publisher.sendString({ queue: 'dispatch-queue', body: '01234567890123456789012345' }),
    /SQS string publish request exceeds the configured size limit of 24 bytes/i,
  );
  assert.equal(client.sendMessageInputs.length, 0);

  await publisher.sendString({ queue: 'dispatch-queue', body: '01234567890123456789012345', sizeValidation: false });

  await assert.rejects(
    () =>
      publisher.sendString({
        queue: 'dispatch-queue',
        body: '01234567890123456789012345',
        sizeValidation: { maxBytes: 12 },
      }),
    /configured size limit of 12 bytes/i,
  );

  await assert.rejects(
    () =>
      publisher.sendStringBatch({
        queue: 'dispatch-queue',
        sizeValidation: { maxBytes: 8 },
        entries: [{ id: 'job-0', body: 'too-large' }],
      }),
    /SQS batch publish entry job-0 exceeds the configured size limit of 8 bytes/i,
  );
  assert.equal(client.sendMessageBatchInputs.length, 0);

  const rawAttribute: SqsMessageAttributeValue = { DataType: 'String', StringValue: 'abc' };
  await assert.rejects(
    () =>
      publisher.sendJson({
        queue: 'dispatch-queue',
        payload: { ok: true },
        sizeValidation: { maxBytes: 20 },
        messageAttributes: { channel: rawAttribute },
      }),
    /configured size limit of 20 bytes/i,
  );
});
