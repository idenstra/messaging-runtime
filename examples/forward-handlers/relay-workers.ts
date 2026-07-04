import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  AwsSnsAdapter,
  AwsSqsAdapter,
  SnsPublisher,
  SqsPublisher,
  SqsWorkerServiceRoute,
  snsStringAttribute,
  sqsJsonRoute,
  sqsJsonToTopicForwardHandler,
  sqsStringRoute,
  sqsStringToQueueForwardHandler,
} from '@idenstra/messaging-runtime';

type EventPayload = { eventId: string; eventType: string };

const sqsAdapter = new AwsSqsAdapter(new SQSClient({ region: 'us-east-1' }));
const snsAdapter = new AwsSnsAdapter(new SNSClient({ region: 'us-east-1' }));
const queuePublisher = new SqsPublisher(sqsAdapter);
const topicPublisher = new SnsPublisher(snsAdapter);

const queueRelayRoute: SqsWorkerServiceRoute<string> = sqsStringRoute({
  name: 'raw-relay',
  queue: 'raw-relay',
  handle: sqsStringToQueueForwardHandler({
    publisher: queuePublisher,
    queue: 'raw-output',
    copyMessageAttributes: true,
    delaySeconds: 1,
  }),
});

const topicRelayRoute: SqsWorkerServiceRoute<EventPayload> = sqsJsonRoute<EventPayload>({
  name: 'event-relay',
  queue: 'event-relay',
  handle: sqsJsonToTopicForwardHandler({
    publisher: topicPublisher,
    topic: 'event-stream',
    copyMessageAttributes: true,
    subject: ({ payload }) => payload.eventType,
    buildMessageAttributes: ({ copiedMessageAttributes, payload }) => ({
      ...copiedMessageAttributes,
      relay: snsStringAttribute(payload.eventType),
    }),
  }),
});

void [queueRelayRoute, topicRelayRoute];
