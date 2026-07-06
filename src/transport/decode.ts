import {
  assertNonEmptyText,
  assertRecord,
  assertSnsEnvelopeType,
  DEFAULT_SNS_ENVELOPE_LABEL,
  DEFAULT_SNS_NOTIFICATION_LABEL,
  DEFAULT_SQS_JSON_LABEL,
  readOptionalText,
} from './shared';
import type { DecodedSnsNotificationJson, SnsEnvelope, SnsNotificationEnvelope } from './types';

export function decodeSqsJsonBody<TPayload>(body: string | undefined, label = DEFAULT_SQS_JSON_LABEL): TPayload {
  const rawBody = assertNonEmptyText(body, label);

  try {
    return JSON.parse(rawBody) as TPayload;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON.`, { cause: error });
  }
}

export function decodeSnsEnvelope(body: string | undefined, label = DEFAULT_SNS_ENVELOPE_LABEL): SnsEnvelope {
  const envelope = assertRecord(decodeSqsJsonBody<Record<string, unknown>>(body, label), label);
  const type = assertSnsEnvelopeType(envelope.Type, label);
  const messageId = assertNonEmptyText(envelope.MessageId, `${label} MessageId`);
  const topicArn = assertNonEmptyText(envelope.TopicArn, `${label} TopicArn`);
  const message = assertNonEmptyText(envelope.Message, `${label} Message`);
  const timestamp = assertNonEmptyText(envelope.Timestamp, `${label} Timestamp`);
  const common = {
    ...envelope,
    Type: type,
    MessageId: messageId,
    TopicArn: topicArn,
    Message: message,
    Timestamp: timestamp,
  };

  switch (type) {
    case 'Notification': {
      const subject = readOptionalText(envelope.Subject, `${label} Subject`);
      const notificationEnvelope: SnsNotificationEnvelope =
        subject === undefined
          ? { ...common, Type: 'Notification' }
          : { ...common, Type: 'Notification', Subject: subject };
      return notificationEnvelope;
    }
    case 'SubscriptionConfirmation':
      return {
        ...common,
        Type: 'SubscriptionConfirmation',
        Token: assertNonEmptyText(envelope.Token, `${label} Token`),
        SubscribeURL: assertNonEmptyText(envelope.SubscribeURL, `${label} SubscribeURL`),
      };
    case 'UnsubscribeConfirmation':
      return {
        ...common,
        Type: 'UnsubscribeConfirmation',
        Token: assertNonEmptyText(envelope.Token, `${label} Token`),
        SubscribeURL: assertNonEmptyText(envelope.SubscribeURL, `${label} SubscribeURL`),
      };
  }
}

export function decodeSnsNotificationJson<TPayload>(
  body: string | undefined,
  label = DEFAULT_SNS_NOTIFICATION_LABEL,
): DecodedSnsNotificationJson<TPayload> {
  const envelope = decodeSnsEnvelope(body, label);
  if (envelope.Type !== 'Notification') {
    throw new Error(`${label} must be an SNS Notification envelope.`);
  }

  return { envelope, payload: decodeSqsJsonBody<TPayload>(envelope.Message, `${label} payload`) };
}
