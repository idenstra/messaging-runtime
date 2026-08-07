import {
  type SqsWorkerRoute,
  type SqsWorkerServiceRoute,
  snsJsonQueueRoute,
  sqsJsonRoute,
  sqsStringRoute,
} from '@idenstra/messaging-runtime';

type JobPayload = { jobId: string };

type UserCreated = { userId: string };

const directJsonRoute: SqsWorkerRoute<JobPayload> = sqsJsonRoute<JobPayload>({
  name: 'jobs',
  queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
  handle: async ({ payload }) => {
    consumeText(payload.jobId);
  },
});

const hostJsonRoute: SqsWorkerServiceRoute<JobPayload> = sqsJsonRoute<JobPayload>({
  name: 'jobs',
  queue: 'jobs',
  handle: async ({ payload }) => {
    consumeText(payload.jobId);
  },
});

const hostStringRoute: SqsWorkerServiceRoute<string> = sqsStringRoute({
  name: 'raw-jobs',
  queue: 'raw-jobs',
  handle: async ({ payload }) => {
    consumeText(payload);
  },
});

const snsPayloadRoute: SqsWorkerServiceRoute<UserCreated> = snsJsonQueueRoute<UserCreated>({
  name: 'user-created',
  queue: 'user-created',
  handle: async ({ payload }) => {
    consumeText(payload.userId);
  },
});

const snsEnvelopeRoute = snsJsonQueueRoute<UserCreated>({
  name: 'user-created-envelope',
  queue: 'user-created',
  messageShape: 'envelope+payload',
  handle: async ({ payload }) => {
    consumeText(payload.envelope.TopicArn);
    consumeText(payload.payload.userId);
  },
});

void [directJsonRoute, hostJsonRoute, hostStringRoute, snsPayloadRoute, snsEnvelopeRoute];

function consumeText(_value: string): void {}
