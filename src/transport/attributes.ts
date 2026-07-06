import type { MessageAttributeValue as SnsSdkMessageAttributeValue } from '@aws-sdk/client-sns';
import type { MessageAttributeValue as SqsSdkMessageAttributeValue } from '@aws-sdk/client-sqs';
import { assertNonEmptyBinaryValue, assertNonEmptyText, normalizeNumericAttributeValue } from './assertions';
import type { SnsStringArrayAttributeValue } from './types';

export function sqsStringAttribute(value: string): SqsSdkMessageAttributeValue {
  return { DataType: 'String', StringValue: assertNonEmptyText(value, 'SQS string attribute value') };
}

export function sqsNumberAttribute(value: number | bigint | string): SqsSdkMessageAttributeValue {
  return { DataType: 'Number', StringValue: normalizeNumericAttributeValue(value, 'SQS number attribute value') };
}

export function sqsBinaryAttribute(value: Uint8Array): SqsSdkMessageAttributeValue {
  return { DataType: 'Binary', BinaryValue: assertNonEmptyBinaryValue(value, 'SQS binary attribute value') };
}

export function snsStringAttribute(value: string): SnsSdkMessageAttributeValue {
  return { DataType: 'String', StringValue: assertNonEmptyText(value, 'SNS string attribute value') };
}

export function snsNumberAttribute(value: number | bigint | string): SnsSdkMessageAttributeValue {
  return { DataType: 'Number', StringValue: normalizeNumericAttributeValue(value, 'SNS number attribute value') };
}

export function snsBinaryAttribute(value: Uint8Array): SnsSdkMessageAttributeValue {
  return { DataType: 'Binary', BinaryValue: assertNonEmptyBinaryValue(value, 'SNS binary attribute value') };
}

export function snsStringArrayAttribute(values: readonly SnsStringArrayAttributeValue[]): SnsSdkMessageAttributeValue {
  return { DataType: 'String.Array', StringValue: JSON.stringify([...values]) };
}
