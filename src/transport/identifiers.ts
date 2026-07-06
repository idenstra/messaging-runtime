import { assertAwsAccountId, assertNonEmptyIdentifier } from './assertions';

export const SQS_ARN_SERVICE = 'sqs';
export const SNS_ARN_SERVICE = 'sns';

export function isArnForService(value: string, service: string): boolean {
  const parts = value.split(':');
  return parts.length >= 6 && parts[0] === 'arn' && parts[2] === service;
}

export function extractNameFromArn(arn: string, service: string, label: string): string {
  if (!isArnForService(arn, service)) {
    throw new Error(`${label} must be a valid ${service.toUpperCase()} ARN.`);
  }

  const resource = arn.split(':').slice(5).join(':');
  const resourceName = resource.split(/[/:]/).filter(Boolean).at(-1);
  if (!resourceName) {
    throw new Error(`${label} must include a resource name.`);
  }
  return resourceName;
}

export function extractAccountIdFromArn(arn: string, service: string, label: string): string {
  if (!isArnForService(arn, service)) {
    throw new Error(`${label} must be a valid ${service.toUpperCase()} ARN.`);
  }

  const accountId = arn.split(':')[4];
  return assertAwsAccountId(accountId ?? '', `${label} account ID`);
}

export function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

export function assertSqsQueueUrl(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!isHttpUrl(normalized)) {
    throw new Error(`${label} must be an SQS queue URL.`);
  }
  return normalized;
}

export function assertSnsTopicArn(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  const parts = normalized.split(':');
  if (!isArnForService(normalized, SNS_ARN_SERVICE) || parts.length !== 6 || !parts[5]) {
    throw new Error(`${label} must be an SNS topic ARN.`);
  }
  return normalized;
}

export function extractNameFromUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    const name = url.pathname.split('/').filter(Boolean).at(-1);
    if (!name) {
      throw new Error(`${label} must include a queue name in the path.`);
    }
    return name;
  } catch (error) {
    throw new Error(`Invalid ${label}.`, { cause: error });
  }
}

export function extractAccountIdFromSqsQueueUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const accountId = pathSegments.at(-2);
    if (!accountId || !/^\d{12}$/.test(accountId)) {
      return undefined;
    }

    return accountId;
  } catch {
    return undefined;
  }
}
