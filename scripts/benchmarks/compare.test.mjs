import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildBenchmarkComparison,
  buildEnvironmentFingerprint,
  compareEnvironmentFingerprints,
  loadBenchmarkReport,
  renderMarkdownComparison,
  validateBenchmarkReport,
} from './compare.mjs';

function createReport(overrides = {}) {
  return {
    packageName: '@idenstra/messaging-runtime',
    packageVersion: '0.1.0',
    nodeVersion: 'v24.18.0',
    platform: 'linux',
    arch: 'x64',
    cpuModel: 'Test CPU',
    command: 'npm run benchmark:ci',
    warmupSamples: 1,
    measuredSamples: 3,
    scenarios: [
      {
        name: 'worker:single-route-full-batch',
        description: 'Full batch worker path.',
        iterationsPerSample: 20,
        sampleDurationsMs: [100, 101, 102],
        meanMsPerIteration: 5.05,
        medianMsPerIteration: 5,
        p95MsPerIteration: 5.1,
        minMsPerIteration: 4.9,
        maxMsPerIteration: 5.2,
        opsPerSecond: 200,
      },
      {
        name: 'worker:ack-delete',
        description: 'Delete path.',
        iterationsPerSample: 20,
        sampleDurationsMs: [20, 20, 20],
        meanMsPerIteration: 1,
        medianMsPerIteration: 1,
        p95MsPerIteration: 1.1,
        minMsPerIteration: 0.9,
        maxMsPerIteration: 1.2,
        opsPerSecond: 1000,
      },
    ],
    ...overrides,
  };
}

test('validateBenchmarkReport accepts a valid benchmark report shape', () => {
  const report = createReport();
  assert.equal(validateBenchmarkReport(report), report);
});

test('validateBenchmarkReport rejects invalid sampleDurationsMs entries', () => {
  const report = createReport({
    scenarios: [{ ...createReport().scenarios[0], sampleDurationsMs: [100, '101', 102] }],
  });

  assert.throws(() => validateBenchmarkReport(report), /sampleDurationsMs\[1\] must be a number/);
});

test('loadBenchmarkReport reads and validates a JSON file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-compare-'));
  const reportPath = path.join(tempDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(createReport())}\n`);

  const loaded = loadBenchmarkReport(reportPath);
  assert.equal(loaded.path, reportPath);
  assert.equal(loaded.report.packageName, '@idenstra/messaging-runtime');
});

test('compareEnvironmentFingerprints detects mismatched machine and sample fields', () => {
  const base = buildEnvironmentFingerprint(createReport());
  const candidate = buildEnvironmentFingerprint(createReport({ nodeVersion: 'v24.19.0', measuredSamples: 5 }));

  const mismatches = compareEnvironmentFingerprints(base, candidate);
  assert.deepEqual(
    mismatches.map((entry) => entry.field),
    ['nodeVersion', 'measuredSamples'],
  );
});

test('buildBenchmarkComparison rejects mismatched environments by default', () => {
  assert.throws(
    () => buildBenchmarkComparison(createReport(), createReport({ cpuModel: 'Different CPU' })),
    /benchmark environment mismatch/,
  );
});

test('buildBenchmarkComparison compares overlapping scenarios and reports added/removed entries', () => {
  const comparison = buildBenchmarkComparison(
    createReport(),
    createReport({
      scenarios: [
        {
          name: 'worker:single-route-full-batch',
          description: 'Full batch worker path.',
          iterationsPerSample: 20,
          sampleDurationsMs: [90, 91, 92],
          meanMsPerIteration: 4.55,
          medianMsPerIteration: 4.5,
          p95MsPerIteration: 4.8,
          minMsPerIteration: 4.4,
          maxMsPerIteration: 4.9,
          opsPerSecond: 222.22,
        },
        {
          name: 'worker:prefetch-hot-queue',
          description: 'New prefetch benchmark.',
          iterationsPerSample: 10,
          sampleDurationsMs: [50, 51, 52],
          meanMsPerIteration: 5.1,
          medianMsPerIteration: 5.1,
          p95MsPerIteration: 5.2,
          minMsPerIteration: 5,
          maxMsPerIteration: 5.3,
          opsPerSecond: 196,
        },
      ],
    }),
    { allowEnvironmentMismatch: false },
  );

  assert.equal(comparison.sameEnvironment, true);
  assert.equal(comparison.comparedScenarioCount, 1);
  assert.equal(comparison.scenarios[0]?.name, 'worker:single-route-full-batch');
  assert.equal(comparison.scenarios[0]?.deltaMedianMsPerIteration, -0.5);
  assert.equal(comparison.addedScenarios[0]?.name, 'worker:prefetch-hot-queue');
  assert.equal(comparison.removedScenarios[0]?.name, 'worker:ack-delete');
});

test('buildBenchmarkComparison rejects duplicate scenario names', () => {
  assert.throws(
    () =>
      buildBenchmarkComparison(
        createReport({
          scenarios: [
            createReport().scenarios[0],
            { ...createReport().scenarios[0], description: 'Duplicate scenario name.' },
          ],
        }),
        createReport(),
      ),
    /duplicate benchmark scenario name: worker:single-route-full-batch/,
  );
});

test('renderMarkdownComparison prints the compared scenario table and mismatch notes', () => {
  const comparison = buildBenchmarkComparison(
    createReport(),
    createReport({
      cpuModel: 'Other CPU',
      scenarios: [
        {
          name: 'worker:single-route-full-batch',
          description: 'Full batch worker path.',
          iterationsPerSample: 20,
          sampleDurationsMs: [105, 106, 107],
          meanMsPerIteration: 5.3,
          medianMsPerIteration: 5.25,
          p95MsPerIteration: 5.4,
          minMsPerIteration: 5.2,
          maxMsPerIteration: 5.5,
          opsPerSecond: 190,
        },
      ],
    }),
    { allowEnvironmentMismatch: true },
  );

  const markdown = renderMarkdownComparison(comparison, '/tmp/base.json', '/tmp/candidate.json');

  assert.match(markdown, /# Benchmark comparison/);
  assert.match(markdown, /Same environment: no/);
  assert.match(markdown, /worker:single-route-full-batch/);
  assert.match(markdown, /Environment mismatches/);
});
