import assert from 'node:assert/strict';
import test from 'node:test';
import { packageMetadata } from '../src/index';

test('exports the runtime-core package metadata', () => {
  assert.equal(packageMetadata.name, '@idenstra/messaging-runtime');
  assert.equal(packageMetadata.phase, 'runtime-core-and-transport');
});
