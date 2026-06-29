#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicEntrypoints } from './public-surface.mjs';

const root = process.cwd();

export function buildInterfaceReportArgs(configPath, write) {
  const args = ['run'];
  if (write) {
    args.push('--local');
  }

  args.push('--config', configPath);
  return args;
}

export function getInterfaceReportBinaryPath(repoRoot = root) {
  return path.join(repoRoot, 'node_modules', '.bin', 'api-extractor');
}

export function runInterfaceReports(repoRoot = root, options = {}) {
  const write = options.write ?? false;
  const reportBinaryPath = options.reportBinaryPath ?? getInterfaceReportBinaryPath(repoRoot);
  const tempReportDirectory = path.join(repoRoot, 'temp', 'public-surface-report');

  fs.mkdirSync(path.join(repoRoot, 'etc'), { recursive: true });
  fs.mkdirSync(tempReportDirectory, { recursive: true });

  try {
    for (const entrypoint of publicEntrypoints) {
      const configPath = path.join(repoRoot, entrypoint.reportConfigPath);
      const args = buildInterfaceReportArgs(configPath, write);

      childProcess.execFileSync(reportBinaryPath, args, { cwd: repoRoot, stdio: 'inherit' });
    }
  } finally {
    fs.rmSync(tempReportDirectory, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, 'temp'), { recursive: true, force: true });
  }
}

function runCli() {
  const write = process.argv.includes('--write');
  runInterfaceReports(root, { write });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
