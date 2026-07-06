import assert from 'node:assert/strict';
import test from 'node:test';
import {
  snsBinaryAttribute,
  snsNumberAttribute,
  snsStringArrayAttribute,
  snsStringAttribute,
  sqsBinaryAttribute,
  sqsNumberAttribute,
  sqsStringAttribute,
} from '../../src';

test('attribute helper builders return service-native AWS attribute shapes', () => {
  assert.deepEqual(sqsStringAttribute('alpha'), { DataType: 'String', StringValue: 'alpha' });
  assert.deepEqual(sqsNumberAttribute(42), { DataType: 'Number', StringValue: '42' });
  assert.deepEqual(sqsBinaryAttribute(Buffer.from('abc')), { DataType: 'Binary', BinaryValue: Buffer.from('abc') });
  assert.deepEqual(snsStringAttribute('beta'), { DataType: 'String', StringValue: 'beta' });
  assert.deepEqual(snsNumberAttribute('3.14'), { DataType: 'Number', StringValue: '3.14' });
  assert.deepEqual(snsBinaryAttribute(Buffer.from('xyz')), { DataType: 'Binary', BinaryValue: Buffer.from('xyz') });
  assert.deepEqual(snsStringArrayAttribute(['alpha', 2, true, null]), {
    DataType: 'String.Array',
    StringValue: JSON.stringify(['alpha', 2, true, null]),
  });
});
