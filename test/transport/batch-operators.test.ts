import assert from 'node:assert/strict';
import test from 'node:test';
import { SqsMessageBatchOperator } from '../../src';
import { FakeSqsTransportClient } from './support';

test('SqsMessageBatchOperator deleteMessages chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withDeleteBatchResponse({ Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}` })) })
    .withDeleteBatchResponse({
      Successful: [{ Id: 'entry-10' }],
      Failed: [{ Id: 'entry-11', Code: 'ReceiptHandleIsInvalid', Message: 'boom', SenderFault: true }],
    });
  const operator = new SqsMessageBatchOperator(client);

  const result = await operator.deleteMessages({
    queue: 'dispatch-queue',
    entries: Array.from({ length: 12 }, (_, index) => ({ id: `job-${index}`, receiptHandle: `receipt-${index}` })),
  });

  assert.equal(client.deleteMessageBatchInputs.length, 2);
  assert.equal(client.deleteMessageBatchInputs[0]?.Entries?.length, 10);
  assert.equal(client.deleteMessageBatchInputs[1]?.Entries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.successfulById['job-0'], { id: 'job-0' });
  assert.equal(result.failedById['job-11']?.code, 'ReceiptHandleIsInvalid');
});

test('SqsMessageBatchOperator changeMessageVisibility chunks entries, forwards per-entry timeouts, and normalizes results', async () => {
  const client = new FakeSqsTransportClient()
    .withQueueUrl('dispatch-queue', 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue')
    .withVisibilityBatchResponse({
      Successful: [{ Id: 'entry-0' }],
      Failed: [{ Id: 'entry-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const operator = new SqsMessageBatchOperator(client);

  const result = await operator.changeMessageVisibility({
    queue: 'dispatch-queue',
    entries: [
      { id: 'job-0', receiptHandle: 'receipt-0', visibilityTimeoutSeconds: 30 },
      { id: 'job-1', receiptHandle: 'receipt-1', visibilityTimeoutSeconds: 45 },
    ],
  });

  assert.deepEqual(client.changeMessageVisibilityBatchInputs[0], {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
    Entries: [
      { Id: 'entry-0', ReceiptHandle: 'receipt-0', VisibilityTimeout: 30 },
      { Id: 'entry-1', ReceiptHandle: 'receipt-1', VisibilityTimeout: 45 },
    ],
  });
  assert.deepEqual(result.successfulById['job-0'], { id: 'job-0' });
  assert.equal(result.failedById['job-1']?.message, 'boom');
});

test('SqsMessageBatchOperator rejects duplicate caller IDs before any AWS call', async () => {
  const client = new FakeSqsTransportClient().withQueueUrl(
    'dispatch-queue',
    'https://sqs.us-east-1.amazonaws.com/123456789012/dispatch-queue',
  );
  const operator = new SqsMessageBatchOperator(client);

  await assert.rejects(
    () =>
      operator.deleteMessages({
        queue: 'dispatch-queue',
        entries: [
          { id: 'job-0', receiptHandle: 'receipt-0' },
          { id: 'job-0', receiptHandle: 'receipt-1' },
        ],
      }),
    /Duplicate SQS delete batch entry id "job-0" is not allowed\./i,
  );
  assert.equal(client.deleteMessageBatchInputs.length, 0);
});
