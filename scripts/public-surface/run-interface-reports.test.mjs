import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInterfaceReportArgs } from './run-interface-reports.mjs';

test('buildInterfaceReportArgs enables local mode when refreshing approved reports', () => {
  assert.deepEqual(buildInterfaceReportArgs('public-surface-report.root.json', true), [
    'run',
    '--local',
    '--config',
    'public-surface-report.root.json',
  ]);
});

test('buildInterfaceReportArgs uses check mode when validating approved reports', () => {
  assert.deepEqual(buildInterfaceReportArgs('public-surface-report.root.json', false), [
    'run',
    '--config',
    'public-surface-report.root.json',
  ]);
});
