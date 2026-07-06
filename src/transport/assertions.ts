import type { SnsEnvelopeType } from './types';

export const DEFAULT_SQS_JSON_LABEL = 'SQS message body';
export const DEFAULT_SNS_ENVELOPE_LABEL = 'SNS envelope body';
export const DEFAULT_SNS_NOTIFICATION_LABEL = 'SNS notification message';

export function assertAwsAccountId(value: string, label: string): string {
  const normalized = assertNonEmptyIdentifier(value, label);
  if (!/^\d{12}$/.test(normalized)) {
    throw new Error(`${label} must be a 12-digit AWS account ID.`);
  }
  return normalized;
}

export function assertNonEmptyIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return normalized;
}

export function assertNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

export function readOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertNonEmptyText(value, label);
}

export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must decode to a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function assertSnsEnvelopeType(value: unknown, label: string): SnsEnvelopeType {
  switch (value) {
    case 'Notification':
    case 'SubscriptionConfirmation':
    case 'UnsubscribeConfirmation':
      return value;
    default:
      throw new Error(`${label} Type must be Notification, SubscriptionConfirmation, or UnsubscribeConfirmation.`);
  }
}

export function normalizeNumericAttributeValue(value: number | bigint | string, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number.`);
    }
    return value.toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  const normalized = assertNonEmptyText(value, label);
  if (!/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    throw new Error(`${label} must be a numeric string.`);
  }
  return normalized;
}

export function assertNonEmptyBinaryValue(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`${label} must be a non-empty Uint8Array.`);
  }
  return value;
}

export function assertIntegerInRange(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

export function assertPositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}
