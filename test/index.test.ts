import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/index';

test('root entrypoint exports the preferred worker and transport helpers', () => {
  assert.equal(typeof runtime.sqsJsonRoute, 'function');
  assert.equal(typeof runtime.SqsWorkerServiceHost, 'function');
  assert.equal(typeof runtime.AwsSqsAdapter, 'function');
});
