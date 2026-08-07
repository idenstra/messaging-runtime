import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSnsEnvelope, decodeSnsNotificationJson, decodeSqsJsonBody } from '../../src';

test('decodeSqsJsonBody parses valid JSON', () => {
  const decoded = decodeSqsJsonBody<{ kind: string }>(JSON.stringify({ kind: 'alpha' }));
  assert.deepEqual(decoded, { kind: 'alpha' });
});

test('decodeSqsJsonBody rejects missing or invalid JSON', () => {
  assert.throws(() => decodeSqsJsonBody(undefined), /SQS message body must be a non-empty string/i);
  assert.throws(() => decodeSqsJsonBody('{'), /Invalid SQS message body JSON/i);
});

test('decodeSnsEnvelope parses notification envelopes and preserves metadata', () => {
  const decoded = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
      Subject: 'Hello',
      Message: JSON.stringify({ kind: 'delivery' }),
      Timestamp: '2026-06-29T00:00:00.000Z',
      SignatureVersion: '1',
    }),
  );

  assert.equal(decoded.Type, 'Notification');
  assert.equal(decoded.TopicArn, 'arn:aws:sns:us-east-1:123456789012:example-email-events');
  assert.equal(decoded.Subject, 'Hello');
  assert.equal(decoded.SignatureVersion, '1');
});

test('decodeSnsEnvelope parses subscription confirmation and unsubscribe confirmation envelopes', () => {
  const subscription = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'SubscriptionConfirmation',
      MessageId: 'sns-2',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
      Message: 'confirm',
      Timestamp: '2026-06-29T00:00:00.000Z',
      Token: 'token-1',
      SubscribeURL: 'https://sns.example/confirm',
    }),
  );
  const unsubscribe = decodeSnsEnvelope(
    JSON.stringify({
      Type: 'UnsubscribeConfirmation',
      MessageId: 'sns-3',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
      Message: 'unsubscribe',
      Timestamp: '2026-06-29T00:00:00.000Z',
      Token: 'token-2',
      SubscribeURL: 'https://sns.example/unsubscribe',
    }),
  );

  assert.equal(subscription.Type, 'SubscriptionConfirmation');
  assert.equal(subscription.Token, 'token-1');
  assert.equal(unsubscribe.Type, 'UnsubscribeConfirmation');
  assert.equal(unsubscribe.SubscribeURL, 'https://sns.example/unsubscribe');
});

test('decodeSnsEnvelope rejects malformed non-SNS bodies', () => {
  assert.throws(() => decodeSnsEnvelope(JSON.stringify({ foo: 'bar' })), /Type must be Notification/i);
});

test('decodeSnsNotificationJson parses notification JSON and rejects control or invalid payloads', () => {
  const decoded = decodeSnsNotificationJson<{ eventType: string }>(
    JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-1',
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
      Message: JSON.stringify({ eventType: 'DELIVERY' }),
      Timestamp: '2026-06-29T00:00:00.000Z',
    }),
  );

  assert.equal(decoded.envelope.Type, 'Notification');
  assert.deepEqual(decoded.payload, { eventType: 'DELIVERY' });

  assert.throws(
    () =>
      decodeSnsNotificationJson(
        JSON.stringify({
          Type: 'SubscriptionConfirmation',
          MessageId: 'sns-2',
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
          Message: 'confirm',
          Timestamp: '2026-06-29T00:00:00.000Z',
          Token: 'token-1',
          SubscribeURL: 'https://sns.example/confirm',
        }),
      ),
    /must be an SNS Notification envelope/i,
  );
  assert.throws(
    () =>
      decodeSnsNotificationJson(
        JSON.stringify({
          Type: 'Notification',
          MessageId: 'sns-3',
          TopicArn: 'arn:aws:sns:us-east-1:123456789012:example-email-events',
          Message: '{',
          Timestamp: '2026-06-29T00:00:00.000Z',
        }),
      ),
    /Invalid SNS notification message payload JSON/i,
  );
});
