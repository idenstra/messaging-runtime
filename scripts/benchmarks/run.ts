import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { createBenchmarkScenarios } from './scenarios/index';
import type { BenchmarkReport, BenchmarkScenario, BenchmarkScenarioResult } from './support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const baselineJsonPath = path.join(repoRoot, 'docs/benchmarks/baseline.json');
const baselineMarkdownPath = path.join(repoRoot, 'docs/benchmarks/baseline.md');
const packageJsonPath = path.join(repoRoot, 'package.json');
const warmupSamples = 1;
const measuredSamples = 3;

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const packageMetadata = await readPackageMetadata();
  const scenarios = createBenchmarkScenarios();
  const results: BenchmarkScenarioResult[] = [];

  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const report: BenchmarkReport = {
    packageName: packageMetadata.name,
    packageVersion: packageMetadata.version,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model,
    command: getBenchmarkCommandLabel(args),
    warmupSamples,
    measuredSamples,
    scenarios: results,
  };

  if (args.has('--write-baseline')) {
    await fs.mkdir(path.dirname(baselineJsonPath), { recursive: true });
    await fs.writeFile(baselineJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(baselineMarkdownPath, renderMarkdownReport(report));
    formatBaselineArtifacts();
  }

  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderMarkdownReport(report));
}

function getBenchmarkCommandLabel(args: Set<string>): string {
  if (args.has('--write-baseline')) {
    return 'npm run benchmark:baseline';
  }

  if (args.has('--json')) {
    return 'npm run benchmark:ci';
  }

  return 'npm run benchmark';
}

function formatBaselineArtifacts(): void {
  const biomeBinary = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.cmd' : 'biome');
  childProcess.execFileSync(biomeBinary, ['format', '--write', baselineJsonPath, baselineMarkdownPath], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

async function runScenario(scenario: BenchmarkScenario): Promise<BenchmarkScenarioResult> {
  for (let index = 0; index < warmupSamples; index += 1) {
    await runScenarioSample(scenario);
  }

  const sampleDurationsMs: number[] = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    sampleDurationsMs.push(await runScenarioSample(scenario));
  }

  const perIterationDurations = sampleDurationsMs.map((duration) => duration / scenario.iterationsPerSample);

  return {
    name: scenario.name,
    description: scenario.description,
    iterationsPerSample: scenario.iterationsPerSample,
    sampleDurationsMs: sampleDurationsMs.map((duration) => round(duration)),
    meanMsPerIteration: round(mean(perIterationDurations)),
    medianMsPerIteration: round(percentile(perIterationDurations, 0.5)),
    p95MsPerIteration: round(percentile(perIterationDurations, 0.95)),
    minMsPerIteration: round(Math.min(...perIterationDurations)),
    maxMsPerIteration: round(Math.max(...perIterationDurations)),
    opsPerSecond: round(1_000 / mean(perIterationDurations)),
  };
}

async function runScenarioSample(scenario: BenchmarkScenario): Promise<number> {
  const startedAt = performance.now();

  for (let iteration = 0; iteration < scenario.iterationsPerSample; iteration += 1) {
    await scenario.runIteration();
  }

  return performance.now() - startedAt;
}

async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  return JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { name: string; version: string };
}

function renderMarkdownReport(report: BenchmarkReport): string {
  const lines = [
    '# Benchmark baseline',
    '',
    `Package: \`${report.packageName}@${report.packageVersion}\``,
    `Node: \`${report.nodeVersion}\``,
    `Platform: \`${report.platform}/${report.arch}\``,
    report.cpuModel ? `CPU: \`${report.cpuModel}\`` : undefined,
    `Command: \`${report.command}\``,
    `Warmup samples: \`${report.warmupSamples}\``,
    `Measured samples: \`${report.measuredSamples}\``,
    '',
    '| Scenario | Description | Iterations/sample | Median ms/iteration | P95 ms/iteration | Ops/sec |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...report.scenarios.map(
      (scenario) =>
        `| \`${scenario.name}\` | ${scenario.description} | ${scenario.iterationsPerSample} | ${scenario.medianMsPerIteration.toFixed(4)} | ${scenario.p95MsPerIteration.toFixed(4)} | ${scenario.opsPerSecond.toFixed(2)} |`,
    ),
    '',
    'These numbers are fake-client-first local baselines. They are intended to make later throughput work evidence-based, not to support comparative public speed claims yet.',
    '',
  ].filter((line): line is string => line !== undefined);

  return `${lines.join('\n')}\n`;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

void main().catch((error: unknown) => {
  process.stderr.write(`${inspect(error)}\n`);
  process.exitCode = 1;
});
