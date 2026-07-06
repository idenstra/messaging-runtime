import assert from 'node:assert/strict';
import test from 'node:test';
import { SnsPublisher } from '../../src';
import { FakeSnsTransportClient } from './support';

test('SnsPublisher publishJson resolves topic identifiers and validates standard-topic semantics', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events' }],
  });
  const publisher = new SnsPublisher(client);

  const result = await publisher.publishJson({
    topic: 'idenstra-email-events',
    payload: { kind: 'delivery' },
    subject: 'SES Delivery',
    messageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
    messageGroupId: 'group-1',
  });

  assert.equal(result.topicArn, 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events');
  assert.deepEqual(client.publishInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
    Message: JSON.stringify({ kind: 'delivery' }),
    Subject: 'SES Delivery',
    MessageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
    MessageGroupId: 'group-1',
    MessageDeduplicationId: undefined,
  });

  await assert.rejects(
    () =>
      publisher.publishJson({
        topic: 'idenstra-email-events',
        payload: { kind: 'delivery' },
        messageDeduplicationId: 'dedupe-1',
      }),
    /SNS publish request must not declare messageDeduplicationId for a standard SNS topic/i,
  );
});

test('SnsPublisher publishString and publishSerialized send explicit string-mode messages', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:events' }],
  });
  const publisher = new SnsPublisher(client);

  await publisher.publishString({ topic: 'events', message: 'plain text event' });
  await publisher.publishSerialized({
    topic: 'events',
    payload: { eventId: 'event-1' },
    serialize: (payload) => `event:${payload.eventId}`,
  });

  assert.equal(client.publishInputs[0]?.Message, 'plain text event');
  assert.equal(client.publishInputs[1]?.Message, 'event:event-1');
});

test('SnsPublisher publishJson enforces FIFO group semantics and allows omitted dedupe IDs', async () => {
  const client = new FakeSnsTransportClient();
  const publisher = new SnsPublisher(client);

  await publisher.publishJson({
    topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    payload: { kind: 'delivery' },
    messageGroupId: 'group-1',
  });

  assert.deepEqual(client.publishInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    Message: JSON.stringify({ kind: 'delivery' }),
    Subject: undefined,
    MessageAttributes: undefined,
    MessageGroupId: 'group-1',
    MessageDeduplicationId: undefined,
  });

  await assert.rejects(
    () =>
      publisher.publishJson({ topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo', payload: { kind: 'delivery' } }),
    /messageGroupId for SNS publish request/i,
  );

  await assert.rejects(
    () =>
      publisher.publishJson({
        topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
        payload: { kind: 'delivery' },
        messageGroupId: 'group-1',
        messageDeduplicationId: '',
      }),
    /messageDeduplicationId for SNS publish request/i,
  );
});

test('SnsPublisher publishJsonBatch chunks entries and returns keyed aggregate results', async () => {
  const client = new FakeSnsTransportClient()
    .withPublishBatchResponse({
      Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}`, MessageId: `message-${index}` })),
    })
    .withPublishBatchResponse({
      Successful: [{ Id: 'entry-10', MessageId: 'message-10', SequenceNumber: '10' }],
      Failed: [{ Id: 'entry-11', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    });
  const publisher = new SnsPublisher(client);

  const result = await publisher.publishJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:idenstra-email-events',
    entries: Array.from({ length: 12 }, (_, index) => ({
      id: `event-${index}`,
      payload: { index },
      subject: `Event ${index}`,
    })),
  });

  assert.equal(client.publishBatchInputs.length, 2);
  assert.equal(client.publishBatchInputs[0]?.PublishBatchRequestEntries?.length, 10);
  assert.equal(client.publishBatchInputs[1]?.PublishBatchRequestEntries?.length, 2);
  assert.equal(result.requestedCount, 12);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 1);
  assert.equal(result.successfulById['event-10']?.sequenceNumber, '10');
  assert.equal(result.failedById['event-11']?.code, 'InternalError');
});

test('SnsPublisher publishStringBatch and publishSerializedBatch preserve keyed aggregate results', async () => {
  const client = new FakeSnsTransportClient()
    .withPublishBatchResponse({
      Successful: [{ Id: 'entry-0', MessageId: 'message-0' }],
      Failed: [{ Id: 'entry-1', Code: 'InternalError', Message: 'boom', SenderFault: false }],
    })
    .withPublishBatchResponse({ Successful: [{ Id: 'entry-0', MessageId: 'message-2' }] });
  const publisher = new SnsPublisher(client);

  const stringResult = await publisher.publishStringBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events',
    entries: [
      { id: 'event-0', message: 'plain-0' },
      { id: 'event-1', message: 'plain-1' },
    ],
  });
  const serializedResult = await publisher.publishSerializedBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events',
    serialize: (payload: { eventId: string }) => `event:${payload.eventId}`,
    entries: [{ id: 'event-2', payload: { eventId: 'event-2' } }],
  });

  assert.equal(client.publishBatchInputs[0]?.PublishBatchRequestEntries?.[0]?.Message, 'plain-0');
  assert.equal(client.publishBatchInputs[1]?.PublishBatchRequestEntries?.[0]?.Message, 'event:event-2');
  assert.equal(stringResult.failedById['event-1']?.code, 'InternalError');
  assert.equal(serializedResult.successfulById['event-2']?.messageId, 'message-2');
});

test('SnsPublisher publishJsonBatch applies standard and FIFO topic semantics', async () => {
  const client = new FakeSnsTransportClient().withPublishBatchResponse({
    Successful: [{ Id: 'entry-0', MessageId: 'message-0', SequenceNumber: '1' }],
  });
  const publisher = new SnsPublisher(client);

  await publisher.publishJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    entries: [
      { id: 'event-0', payload: { kind: 'delivery' }, messageGroupId: 'group-1', messageDeduplicationId: 'dedupe-1' },
    ],
  });

  assert.deepEqual(client.publishBatchInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    PublishBatchRequestEntries: [
      {
        Id: 'entry-0',
        Message: JSON.stringify({ kind: 'delivery' }),
        Subject: undefined,
        MessageAttributes: undefined,
        MessageGroupId: 'group-1',
        MessageDeduplicationId: 'dedupe-1',
      },
    ],
  });

  await assert.rejects(
    () =>
      publisher.publishJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
        entries: [{ id: 'event-1', payload: { kind: 'delivery' } }],
      }),
    /messageGroupId for SNS batch publish entry event-1/i,
  );

  await assert.rejects(
    () =>
      publisher.publishJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
        entries: [
          { id: 'event-1b', payload: { kind: 'delivery' }, messageGroupId: 'group-1', messageDeduplicationId: '' },
        ],
      }),
    /messageDeduplicationId for SNS batch publish entry event-1b/i,
  );

  const standardClient = new FakeSnsTransportClient().withPublishBatchResponse({
    Successful: [{ Id: 'entry-0', MessageId: 'message-0' }],
  });
  const standardPublisher = new SnsPublisher(standardClient);

  await standardPublisher.publishJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events',
    entries: [{ id: 'event-2', payload: { kind: 'delivery' }, messageGroupId: 'group-2' }],
  });

  assert.deepEqual(standardClient.publishBatchInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:events',
    PublishBatchRequestEntries: [
      {
        Id: 'entry-0',
        Message: JSON.stringify({ kind: 'delivery' }),
        Subject: undefined,
        MessageAttributes: undefined,
        MessageGroupId: 'group-2',
        MessageDeduplicationId: undefined,
      },
    ],
  });

  await assert.rejects(
    () =>
      standardPublisher.publishJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events',
        entries: [{ id: 'event-3', payload: { kind: 'delivery' }, messageDeduplicationId: 'dedupe-3' }],
      }),
    /SNS batch publish entry event-3 must not declare messageDeduplicationId for a standard SNS topic/i,
  );
});

test('SnsPublisher size validation supports defaults, per-call override, disable, and structured entries', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:events' }],
  });
  const publisher = new SnsPublisher(client, undefined, { sizeValidation: { maxBytes: 18 } });

  await assert.rejects(
    () => publisher.publishString({ topic: 'events', message: '01234567890123456789' }),
    /SNS string publish request exceeds the configured size limit of 18 bytes/i,
  );
  assert.equal(client.publishInputs.length, 0);

  await publisher.publishString({ topic: 'events', message: '01234567890123456789', sizeValidation: false });

  await assert.rejects(
    () =>
      publisher.publishJson({
        topic: 'events',
        payload: { ok: true },
        sizeValidation: { maxBytes: 20 },
        messageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
      }),
    /configured size limit of 20 bytes/i,
  );

  await assert.rejects(
    () =>
      publisher.publishStructuredJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events',
        sizeValidation: { maxBytes: 30 },
        entries: [{ id: 'event-0', payload: { default: '0123456789012345678901234567890' } }],
      }),
    /SNS structured batch publish entry event-0 exceeds the configured size limit of 30 bytes/i,
  );
});

test('SnsPublisher publishStructuredJson sets MessageStructure and rejects messageAttributes', async () => {
  const client = new FakeSnsTransportClient().withListTopicsResponse({
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:123456789012:events' }],
  });
  const publisher = new SnsPublisher(client);

  await publisher.publishStructuredJson({
    topic: 'events',
    payload: { default: 'User created', email: 'User created email body', sqs: '{"eventType":"USER_CREATED"}' },
    messageGroupId: 'group-1',
  });

  assert.deepEqual(client.publishInputs[0], {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:events',
    Message: JSON.stringify({
      default: 'User created',
      email: 'User created email body',
      sqs: '{"eventType":"USER_CREATED"}',
    }),
    MessageStructure: 'json',
    Subject: undefined,
    MessageGroupId: 'group-1',
    MessageDeduplicationId: undefined,
  });

  await assert.rejects(
    () => publisher.publishStructuredJson({ topic: 'events', payload: { email: 'missing default' } as never }),
    /must define a "default" protocol value/i,
  );

  await assert.rejects(
    () =>
      publisher.publishStructuredJson({
        topic: 'events',
        payload: { default: 'ok' },
        messageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
      } as never),
    /must not declare messageAttributes when MessageStructure is json/i,
  );

  await assert.rejects(
    () => publisher.publishStructuredJson({ topic: 'events', payload: { default: 'ok', email: 1 } as never }),
    /protocol value "email" must be a string/i,
  );
});

test('SnsPublisher publishStructuredJsonBatch chunks entries and enforces structured semantics', async () => {
  const client = new FakeSnsTransportClient()
    .withPublishBatchResponse({
      Successful: Array.from({ length: 10 }, (_, index) => ({ Id: `entry-${index}`, MessageId: `message-${index}` })),
    })
    .withPublishBatchResponse({ Successful: [{ Id: 'entry-10', MessageId: 'message-10', SequenceNumber: '10' }] });
  const publisher = new SnsPublisher(client);

  const result = await publisher.publishStructuredJsonBatch({
    topic: 'arn:aws:sns:us-east-1:123456789012:events.fifo',
    entries: Array.from({ length: 11 }, (_, index) => ({
      id: `event-${index}`,
      payload: { default: `event ${index}`, sqs: JSON.stringify({ eventId: `event-${index}` }) },
      messageGroupId: 'group-1',
    })),
  });

  assert.equal(client.publishBatchInputs.length, 2);
  assert.equal(client.publishBatchInputs[0]?.PublishBatchRequestEntries?.length, 10);
  assert.deepEqual(client.publishBatchInputs[0]?.PublishBatchRequestEntries?.[0], {
    Id: 'entry-0',
    Message: JSON.stringify({ default: 'event 0', sqs: JSON.stringify({ eventId: 'event-0' }) }),
    MessageStructure: 'json',
    Subject: undefined,
    MessageGroupId: 'group-1',
    MessageDeduplicationId: undefined,
  });
  assert.equal(result.requestedCount, 11);
  assert.equal(result.successfulCount, 11);
  assert.equal(result.failedCount, 0);

  await assert.rejects(
    () =>
      publisher.publishStructuredJsonBatch({
        topic: 'arn:aws:sns:us-east-1:123456789012:events',
        entries: [
          {
            id: 'event-12',
            payload: { default: 'event 12' },
            messageAttributes: { channel: { DataType: 'String', StringValue: 'email' } },
          } as never,
        ],
      }),
    /must not declare messageAttributes when MessageStructure is json/i,
  );
});
