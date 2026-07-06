import assert from 'node:assert/strict';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  assertQueueEmpty,
  cleanupFixtures,
  createQueue,
  createRecordingSqsAdapter,
  createScopedPrefix,
  createStandardRuntimeDefaults,
  createTopic,
  parseJsonMessageBody,
  parseMessageBody,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  sendQueueStringMessage,
  sleep,
  subscribeTopicToQueue,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMessages,
} from '../support/sqs-sns.mjs';

export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const AWS_PROFILE = process.env.AWS_PROFILE;
export const AWS_SMOKE_RUN_ID = process.env.MESSAGING_RUNTIME_AWS_SMOKE_RUN_ID ?? createFallbackRunId();

const forbiddenEndpointEnvVars = [
  'MESSAGING_RUNTIME_LOCALSTACK_ENDPOINT',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_SQS',
  'AWS_ENDPOINT_URL_SNS',
];

export function assertLiveAwsSafeEnvironment() {
  for (const envVar of forbiddenEndpointEnvVars) {
    if (process.env[envVar]) {
      throw new Error(`Live AWS smoke rejected because ${envVar} is set.`);
    }
  }

  if (
    process.env.AWS_ACCESS_KEY_ID === 'test' ||
    process.env.AWS_SECRET_ACCESS_KEY === 'test' ||
    process.env.AWS_SESSION_TOKEN === 'test'
  ) {
    throw new Error('Live AWS smoke rejected because the current shell is using test credentials.');
  }
}

export function createFixturePrefix(label) {
  return createScopedPrefix(AWS_SMOKE_RUN_ID, label, { prefix: 'messaging-runtime' });
}

export function createAwsConfig() {
  return { region: AWS_REGION };
}

export function createSdkClients() {
  const config = createAwsConfig();
  return { sqs: new SQSClient(config), sns: new SNSClient(config), sts: new STSClient(config) };
}

export async function getCallerIdentity(stsClient) {
  const response = await stsClient.send(new GetCallerIdentityCommand({}));
  assert.equal(typeof response.Account, 'string', 'STS must return an AWS account ID.');
  return { accountId: response.Account, arn: response.Arn, userId: response.UserId };
}

function createFallbackRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export {
  assertQueueEmpty,
  cleanupFixtures,
  createQueue,
  createRecordingSqsAdapter,
  createStandardRuntimeDefaults,
  createTopic,
  parseJsonMessageBody,
  parseMessageBody,
  publishTopicStringMessage,
  sendQueueJsonMessage,
  sendQueueStringMessage,
  sleep,
  subscribeTopicToQueue,
  waitForApproximateVisibleMessageCount,
  waitForCondition,
  waitForMessages,
};
