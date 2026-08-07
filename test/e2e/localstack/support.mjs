import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  assertQueueEmpty,
  createQueue,
  createRecordingSnsAdapter,
  createRecordingSqsAdapter,
  createScopedPrefix,
  createStandardRuntimeDefaults,
  createTopic,
  parseJsonMessageBody,
  parseMessageBody,
  parseSnsEnvelopeMessage,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  sendQueueStringMessage,
  sleep,
  subscribeTopicToQueue,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMessages,
} from '../support/index.mjs';

export const LOCALSTACK_ENDPOINT = process.env.MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT ?? 'http://127.0.0.1:4566';
export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const AWS_ACCOUNT_ID = '000000000000';
const RUN_ID = process.env.MESSAGING_RUNTIME_LOCALSTACK_RUN_ID ?? 'manual';

export function createSuitePrefix(suite) {
  return createScopedPrefix(RUN_ID, suite);
}

export function createAwsConfig() {
  return {
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  };
}

export function createSdkClients() {
  const config = createAwsConfig();
  return { sqs: new SQSClient(config), sns: new SNSClient(config) };
}

export {
  assertQueueEmpty,
  createQueue,
  createRecordingSnsAdapter,
  createRecordingSqsAdapter,
  createStandardRuntimeDefaults,
  createTopic,
  parseJsonMessageBody,
  parseMessageBody,
  parseSnsEnvelopeMessage,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  sendQueueStringMessage,
  sleep,
  subscribeTopicToQueue,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMessages,
};
