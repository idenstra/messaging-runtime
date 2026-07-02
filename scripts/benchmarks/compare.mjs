#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function parseCliArgs(argv) {
  const args = { base: null, candidate: null, json: false, allowEnvironmentMismatch: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--base') {
      args.base = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === '--candidate') {
      args.candidate = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--allow-environment-mismatch') {
      args.allowEnvironmentMismatch = true;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  if (!args.base || !args.candidate) {
    throw new Error(
      'usage: node scripts/benchmarks/compare.mjs --base <report.json> --candidate <report.json> [--json] [--allow-environment-mismatch]',
    );
  }

  return args;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function validateBenchmarkReport(report, label = 'benchmark report') {
  assertRecord(report, label);

  const topLevelStringFields = ['packageName', 'packageVersion', 'nodeVersion', 'platform', 'arch', 'command'];
  for (const field of topLevelStringFields) {
    assertString(report[field], `${label}.${field}`);
  }

  if (report.cpuModel !== undefined) {
    assertString(report.cpuModel, `${label}.cpuModel`);
  }

  assertNumber(report.warmupSamples, `${label}.warmupSamples`);
  assertNumber(report.measuredSamples, `${label}.measuredSamples`);

  if (!Array.isArray(report.scenarios)) {
    throw new Error(`${label}.scenarios must be an array`);
  }

  for (const [index, scenario] of report.scenarios.entries()) {
    const scenarioLabel = `${label}.scenarios[${index}]`;
    assertRecord(scenario, scenarioLabel);
    for (const field of ['name', 'description']) {
      assertString(scenario[field], `${scenarioLabel}.${field}`);
    }
    if (!Array.isArray(scenario.sampleDurationsMs)) {
      throw new Error(`${scenarioLabel}.sampleDurationsMs must be an array`);
    }
    for (const [sampleIndex, sampleDurationMs] of scenario.sampleDurationsMs.entries()) {
      assertNumber(sampleDurationMs, `${scenarioLabel}.sampleDurationsMs[${sampleIndex}]`);
    }
    for (const field of [
      'iterationsPerSample',
      'meanMsPerIteration',
      'medianMsPerIteration',
      'p95MsPerIteration',
      'minMsPerIteration',
      'maxMsPerIteration',
      'opsPerSecond',
    ]) {
      assertNumber(scenario[field], `${scenarioLabel}.${field}`);
    }
  }

  return report;
}

export function loadBenchmarkReport(reportPath) {
  const absolutePath = path.resolve(root, reportPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  return { path: absolutePath, report: validateBenchmarkReport(parsed, absolutePath) };
}

export function buildEnvironmentFingerprint(report) {
  return {
    packageName: report.packageName,
    nodeVersion: report.nodeVersion,
    platform: report.platform,
    arch: report.arch,
    cpuModel: report.cpuModel ?? 'unknown',
    warmupSamples: report.warmupSamples,
    measuredSamples: report.measuredSamples,
  };
}

export function compareEnvironmentFingerprints(baseFingerprint, candidateFingerprint) {
  const mismatches = [];

  for (const key of Object.keys(baseFingerprint)) {
    if (baseFingerprint[key] === candidateFingerprint[key]) {
      continue;
    }

    mismatches.push({ field: key, base: baseFingerprint[key], candidate: candidateFingerprint[key] });
  }

  return mismatches;
}

function indexScenarios(report) {
  const scenariosByName = new Map();

  for (const scenario of report.scenarios) {
    if (scenariosByName.has(scenario.name)) {
      throw new Error(`duplicate benchmark scenario name: ${scenario.name}`);
    }

    scenariosByName.set(scenario.name, scenario);
  }

  return scenariosByName;
}

function percentDelta(base, candidate) {
  if (!Number.isFinite(base) || base === 0) {
    return null;
  }

  return ((candidate - base) / base) * 100;
}

export function buildBenchmarkComparison(baseReport, candidateReport, options = {}) {
  const allowEnvironmentMismatch = options.allowEnvironmentMismatch ?? false;
  const baseFingerprint = buildEnvironmentFingerprint(baseReport);
  const candidateFingerprint = buildEnvironmentFingerprint(candidateReport);
  const environmentMismatches = compareEnvironmentFingerprints(baseFingerprint, candidateFingerprint);

  if (environmentMismatches.length > 0 && !allowEnvironmentMismatch) {
    throw new Error(
      `benchmark environment mismatch; rerun on the same machine or pass --allow-environment-mismatch\n${environmentMismatches
        .map((mismatch) => `- ${mismatch.field}: base=${mismatch.base} candidate=${mismatch.candidate}`)
        .join('\n')}`,
    );
  }

  const baseScenarios = indexScenarios(baseReport);
  const candidateScenarios = indexScenarios(candidateReport);
  const comparedScenarioNames = [...baseScenarios.keys()].filter((name) => candidateScenarios.has(name)).sort();

  if (comparedScenarioNames.length === 0) {
    throw new Error('no overlapping benchmark scenarios between base and candidate reports');
  }

  const scenarios = comparedScenarioNames.map((name) => {
    const baseScenario = baseScenarios.get(name);
    const candidateScenario = candidateScenarios.get(name);

    return {
      name,
      description: candidateScenario.description ?? baseScenario.description,
      iterationsPerSample: candidateScenario.iterationsPerSample,
      baseMedianMsPerIteration: baseScenario.medianMsPerIteration,
      candidateMedianMsPerIteration: candidateScenario.medianMsPerIteration,
      deltaMedianMsPerIteration: candidateScenario.medianMsPerIteration - baseScenario.medianMsPerIteration,
      deltaMedianPercent: percentDelta(baseScenario.medianMsPerIteration, candidateScenario.medianMsPerIteration),
      baseP95MsPerIteration: baseScenario.p95MsPerIteration,
      candidateP95MsPerIteration: candidateScenario.p95MsPerIteration,
      deltaP95MsPerIteration: candidateScenario.p95MsPerIteration - baseScenario.p95MsPerIteration,
      deltaP95Percent: percentDelta(baseScenario.p95MsPerIteration, candidateScenario.p95MsPerIteration),
      baseOpsPerSecond: baseScenario.opsPerSecond,
      candidateOpsPerSecond: candidateScenario.opsPerSecond,
      deltaOpsPerSecond: candidateScenario.opsPerSecond - baseScenario.opsPerSecond,
      deltaOpsPercent: percentDelta(baseScenario.opsPerSecond, candidateScenario.opsPerSecond),
    };
  });

  const addedScenarios = [...candidateScenarios.keys()]
    .filter((name) => !baseScenarios.has(name))
    .sort()
    .map((name) => ({ name, description: candidateScenarios.get(name).description }));

  const removedScenarios = [...baseScenarios.keys()]
    .filter((name) => !candidateScenarios.has(name))
    .sort()
    .map((name) => ({ name, description: baseScenarios.get(name).description }));

  return {
    baseFingerprint,
    candidateFingerprint,
    environmentMismatches,
    sameEnvironment: environmentMismatches.length === 0,
    comparedScenarioCount: scenarios.length,
    scenarios,
    addedScenarios,
    removedScenarios,
  };
}

export function renderMarkdownComparison(comparison, basePath, candidatePath) {
  const lines = [
    '# Benchmark comparison',
    '',
    `Base report: \`${basePath}\``,
    `Candidate report: \`${candidatePath}\``,
    `Same environment: ${comparison.sameEnvironment ? 'yes' : 'no'}`,
    '',
    `Base fingerprint: Node \`${comparison.baseFingerprint.nodeVersion}\`, \`${comparison.baseFingerprint.platform}/${comparison.baseFingerprint.arch}\`, CPU \`${comparison.baseFingerprint.cpuModel}\`, samples \`${comparison.baseFingerprint.warmupSamples}+${comparison.baseFingerprint.measuredSamples}\``,
    `Candidate fingerprint: Node \`${comparison.candidateFingerprint.nodeVersion}\`, \`${comparison.candidateFingerprint.platform}/${comparison.candidateFingerprint.arch}\`, CPU \`${comparison.candidateFingerprint.cpuModel}\`, samples \`${comparison.candidateFingerprint.warmupSamples}+${comparison.candidateFingerprint.measuredSamples}\``,
    '',
  ];

  if (comparison.environmentMismatches.length > 0) {
    lines.push('## Environment mismatches', '');
    for (const mismatch of comparison.environmentMismatches) {
      lines.push(`- \`${mismatch.field}\`: base=\`${mismatch.base}\`, candidate=\`${mismatch.candidate}\``);
    }
    lines.push('');
  }

  lines.push(
    '## Scenario deltas',
    '',
    '| Scenario | Base median ms | Candidate median ms | Median delta | Base ops/sec | Candidate ops/sec | Ops delta |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );

  for (const scenario of comparison.scenarios) {
    lines.push(
      `| \`${scenario.name}\` | ${formatNumber(scenario.baseMedianMsPerIteration)} | ${formatNumber(scenario.candidateMedianMsPerIteration)} | ${formatNumber(scenario.deltaMedianMsPerIteration)} (${formatPercent(scenario.deltaMedianPercent)}) | ${formatNumber(scenario.baseOpsPerSecond, 2)} | ${formatNumber(scenario.candidateOpsPerSecond, 2)} | ${formatNumber(scenario.deltaOpsPerSecond, 2)} (${formatPercent(scenario.deltaOpsPercent)}) |`,
    );
  }

  if (comparison.addedScenarios.length > 0) {
    lines.push('', '## Added scenarios', '');
    for (const scenario of comparison.addedScenarios) {
      lines.push(`- \`${scenario.name}\`: ${scenario.description}`);
    }
  }

  if (comparison.removedScenarios.length > 0) {
    lines.push('', '## Removed scenarios', '');
    for (const scenario of comparison.removedScenarios) {
      lines.push(`- \`${scenario.name}\`: ${scenario.description}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const base = loadBenchmarkReport(args.base);
  const candidate = loadBenchmarkReport(args.candidate);
  const comparison = buildBenchmarkComparison(base.report, candidate.report, {
    allowEnvironmentMismatch: args.allowEnvironmentMismatch,
  });

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ basePath: base.path, candidatePath: candidate.path, ...comparison }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(renderMarkdownComparison(comparison, base.path, candidate.path));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[benchmark-compare] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
