#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { relativeUnix } from '../harness/lib/fs-utils.mjs';
import { packageName, publicEntrypoints, supportedPublicExportKeys } from './public-surface.mjs';

const root = process.cwd();

const jsonOutputPath = 'reports/public-surface/exports.json';
const markdownOutputPath = 'reports/public-surface/exports.md';

export function buildPublicSurfaceSnapshot(repoRoot = root) {
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const exportKeys = Object.keys(packageMetadata.exports ?? {}).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  const expectedExportKeys = [...supportedPublicExportKeys].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );

  if (JSON.stringify(exportKeys) !== JSON.stringify(expectedExportKeys)) {
    throw new Error(
      `package.json exports drift detected; expected ${expectedExportKeys.join(', ')}, found ${exportKeys.join(', ')}`,
    );
  }

  const entrypoints = publicEntrypoints.map((entrypoint) => {
    const exportDefinition = packageMetadata.exports[entrypoint.exportKey];
    const declarationPath = path.join(repoRoot, String(exportDefinition.types).replace(/^\.\//, ''));

    if (!fs.existsSync(declarationPath)) {
      throw new Error(`missing declaration entrypoint: ${relativeUnix(repoRoot, declarationPath)}`);
    }

    return {
      subpath: entrypoint.exportKey,
      importSpecifier: entrypoint.importSpecifier,
      declarationPath: relativeUnix(repoRoot, declarationPath),
      symbols: listExportedSymbolNames(declarationPath),
    };
  });

  return { packageName: packageMetadata.name ?? packageName, entrypoints };
}

export function renderPublicSurfaceSnapshotMarkdown(snapshot) {
  const lines = ['# Public surface snapshot', '', `Package: \`${snapshot.packageName}\``, ''];

  for (const entrypoint of snapshot.entrypoints) {
    lines.push(`## ${entrypoint.importSpecifier}`, '');
    lines.push(`- subpath: \`${entrypoint.subpath}\``);
    lines.push(`- declarations: \`${entrypoint.declarationPath}\``);
    lines.push(`- exported symbols (${entrypoint.symbols.length}):`);

    for (const symbolName of entrypoint.symbols) {
      lines.push(`  - \`${symbolName}\``);
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeOrCheckExportSnapshot(repoRoot = root, options = {}) {
  const write = options.write ?? false;
  const snapshot = buildPublicSurfaceSnapshot(repoRoot);
  const jsonContents = `${JSON.stringify(snapshot, null, 2)}\n`;
  const markdownContents = renderPublicSurfaceSnapshotMarkdown(snapshot);

  if (write) {
    writeArtifact(repoRoot, jsonOutputPath, jsonContents);
    writeArtifact(repoRoot, markdownOutputPath, markdownContents);
    return { wrote: true, findings: [] };
  }

  return {
    wrote: false,
    findings: [
      ...compareArtifact(repoRoot, jsonOutputPath, jsonContents),
      ...compareArtifact(repoRoot, markdownOutputPath, markdownContents),
    ],
  };
}

function listExportedSymbolNames(entrypointDeclarationPath) {
  const program = ts.createProgram([entrypointDeclarationPath], {
    allowJs: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    types: [],
  });
  const sourceFile = program.getSourceFile(entrypointDeclarationPath);

  if (!sourceFile) {
    throw new Error(`unable to load declaration source: ${entrypointDeclarationPath}`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    throw new Error(`unable to resolve module symbol for: ${entrypointDeclarationPath}`);
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function compareArtifact(repoRoot, relativePath, expectedContents) {
  const filePath = path.join(repoRoot, relativePath);

  if (!fs.existsSync(filePath)) {
    return [
      {
        code: 'missing-artifact',
        path: relativePath,
        message: `missing checked-in public-surface artifact; refresh with the write mode command`,
      },
    ];
  }

  const currentContents = fs.readFileSync(filePath, 'utf8');
  if (relativePath.endsWith('.json')) {
    if (JSON.stringify(JSON.parse(currentContents)) === JSON.stringify(JSON.parse(expectedContents))) {
      return [];
    }
  } else if (currentContents === expectedContents) {
    return [];
  }

  return [
    {
      code: 'stale-artifact',
      path: relativePath,
      message: `checked-in public-surface artifact is stale; refresh with the write mode command`,
    },
  ];
}

function writeArtifact(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  formatArtifactIfSupported(repoRoot, relativePath);
}

function formatArtifactIfSupported(repoRoot, relativePath) {
  if (!relativePath.endsWith('.json')) {
    return;
  }

  const biomeBinaryPath = path.join(repoRoot, 'node_modules', '.bin', 'biome');
  if (!fs.existsSync(biomeBinaryPath)) {
    return;
  }

  childProcess.execFileSync(biomeBinaryPath, ['format', '--write', relativePath], { cwd: repoRoot, stdio: 'ignore' });
}

function runCli() {
  const { findings } = writeOrCheckExportSnapshot(root, { write: process.argv.includes('--write') });

  if (findings.length === 0) {
    process.exit(0);
  }

  for (const finding of findings) {
    console.error(`[public-surface] ${finding.path}: ${finding.message}`);
  }

  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
