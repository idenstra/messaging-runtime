import assert from 'node:assert/strict';

export function parseMessageBody(message) {
  assert.equal(typeof message.Body, 'string', 'Expected a queue message body.');
  return message.Body;
}

export function parseJsonMessageBody(message) {
  return JSON.parse(parseMessageBody(message));
}

export function parseSnsEnvelopeMessage(message) {
  return JSON.parse(parseMessageBody(message));
}
