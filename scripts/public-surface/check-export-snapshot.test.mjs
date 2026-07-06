import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildPublicSurfaceSnapshot,
  renderPublicSurfaceSnapshotMarkdown,
  writeOrCheckExportSnapshot,
} from './check-export-snapshot.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-export-snapshot-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function seedRepo(repoRoot) {
  writeFile(
    repoRoot,
    'package.json',
    JSON.stringify(
      {
        name: '@idenstra/messaging-runtime',
        exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
          './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
          './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
          './observability': { types: './dist/observability/index.d.ts', default: './dist/observability/index.js' },
        },
      },
      null,
      2,
    ),
  );
  writeFile(
    repoRoot,
    'dist/index.d.ts',
    "export { CoreMarker } from './core/index';\nexport declare const packageMetadata: string;\n",
  );
  writeFile(repoRoot, 'dist/core/index.d.ts', 'export declare const CoreMarker = "core";\n');
  writeFile(repoRoot, 'dist/adapters/nest.d.ts', 'export declare class NestMarker {}\n');
  writeFile(repoRoot, 'dist/observability/index.d.ts', 'export declare function createObservabilityMarker(): void;\n');
}

test('buildPublicSurfaceSnapshot reads the supported exports and declaration symbols', () => {
  const repoRoot = createTempRepo();
  seedRepo(repoRoot);

  const snapshot = buildPublicSurfaceSnapshot(repoRoot);

  assert.deepEqual(snapshot, {
    packageName: '@idenstra/messaging-runtime',
    entrypoints: [
      {
        subpath: '.',
        importSpecifier: '@idenstra/messaging-runtime',
        declarationPath: 'dist/index.d.ts',
        symbols: ['CoreMarker', 'packageMetadata'],
      },
      {
        subpath: './core',
        importSpecifier: '@idenstra/messaging-runtime/core',
        declarationPath: 'dist/core/index.d.ts',
        symbols: ['CoreMarker'],
      },
      {
        subpath: './nest',
        importSpecifier: '@idenstra/messaging-runtime/nest',
        declarationPath: 'dist/adapters/nest.d.ts',
        symbols: ['NestMarker'],
      },
      {
        subpath: './observability',
        importSpecifier: '@idenstra/messaging-runtime/observability',
        declarationPath: 'dist/observability/index.d.ts',
        symbols: ['createObservabilityMarker'],
      },
    ],
  });
});

test('writeOrCheckExportSnapshot reports drift when checked-in artifacts are stale', () => {
  const repoRoot = createTempRepo();
  seedRepo(repoRoot);
  writeFile(repoRoot, 'reports/public-surface/exports.json', '{}\n');
  writeFile(repoRoot, 'reports/public-surface/exports.md', '# stale\n');

  const result = writeOrCheckExportSnapshot(repoRoot);

  assert.deepEqual(
    result.findings.map((finding) => finding.path),
    ['reports/public-surface/exports.json', 'reports/public-surface/exports.md'],
  );
});

test('writeOrCheckExportSnapshot writes refreshed JSON and markdown artifacts', () => {
  const repoRoot = createTempRepo();
  seedRepo(repoRoot);

  const writeResult = writeOrCheckExportSnapshot(repoRoot, { write: true });
  assert.deepEqual(writeResult.findings, []);

  const jsonContents = fs.readFileSync(path.join(repoRoot, 'reports/public-surface/exports.json'), 'utf8');
  const markdownContents = fs.readFileSync(path.join(repoRoot, 'reports/public-surface/exports.md'), 'utf8');
  const snapshot = buildPublicSurfaceSnapshot(repoRoot);

  assert.equal(jsonContents, `${JSON.stringify(snapshot, null, 2)}\n`);
  assert.equal(markdownContents, renderPublicSurfaceSnapshotMarkdown(snapshot));
});
