import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateBenchmarkReport } from './compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const tsxBinary = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const expectedScenarioNames = [
  'decode:sqs-json',
  'decode:sns-over-sqs-json',
  'publisher:sqs-batch',
  'publisher:sns-batch',
  'resolver:cache-hit',
  'resolver:cache-miss-fake-client',
  'worker:ack-delete',
  'worker:visibility-heartbeat',
  'worker:single-route-full-batch',
  'worker:many-routes-empty-poll',
  'worker:single-route-prefetch-hot-queue',
  'worker:single-route-prefetch-delete-batch',
  'worker:failure-keep',
  'worker:stop-drain-buffered',
  'worker:timeout-buffered-backlog',
  'worker:abandon-timeout',
  'snapshot:many-routes',
];

let cachedReport;

function loadBenchmarkReportFromCli() {
  if (cachedReport) {
    return cachedReport;
  }

  const raw = childProcess.execFileSync(tsxBinary, ['scripts/benchmarks/run.ts', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  cachedReport = validateBenchmarkReport(JSON.parse(raw), 'benchmark runner output');
  return cachedReport;
}

test('benchmark runner emits machine-readable JSON with the expected stable scenario order', () => {
  const report = loadBenchmarkReportFromCli();

  assert.equal(report.command, 'npm run benchmark:ci');
  assert.equal(report.warmupSamples, 1);
  assert.equal(report.measuredSamples, 3);
  assert.deepEqual(
    report.scenarios.map((scenario) => scenario.name),
    expectedScenarioNames,
  );
});

test('benchmark runner emits the expected sample-shape for every scenario', () => {
  const report = loadBenchmarkReportFromCli();

  for (const scenario of report.scenarios) {
    assert.equal(scenario.sampleDurationsMs.length, report.measuredSamples);
    assert.equal(typeof scenario.description, 'string');
    assert.equal(typeof scenario.medianMsPerIteration, 'number');
    assert.equal(typeof scenario.opsPerSecond, 'number');
  }
});
