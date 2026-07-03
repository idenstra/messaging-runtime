import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findPackageExportFindings, findPublicImportSurfaceFindings } from './check-public-import-surface.mjs';

function createTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-runtime-public-imports-'));
}

function writeFile(repoRoot, relativePath, contents) {
  const filePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writePackageJson(repoRoot, exportsMap) {
  writeFile(repoRoot, 'package.json', JSON.stringify({ exports: exportsMap }, null, 2));
}

test('findPublicImportSurfaceFindings accepts the supported public imports', () => {
  const repoRoot = createTempRepo();
  writePackageJson(repoRoot, {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
    './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
    './observability': { types: './dist/observability.d.ts', default: './dist/observability.js' },
  });
  writeFile(
    repoRoot,
    'README.md',
    '`@idenstra/messaging-runtime`, `@idenstra/messaging-runtime/nest`, and `@idenstra/messaging-runtime/observability`\n',
  );
  writeFile(repoRoot, 'src/index.ts', "export { packageMetadata } from '@idenstra/messaging-runtime';\n");

  const findings = findPublicImportSurfaceFindings(repoRoot, ['README.md', 'src/index.ts']);

  assert.deepEqual(findings, []);
});

test('findPublicImportSurfaceFindings rejects unsupported deep imports in code and docs', () => {
  const repoRoot = createTempRepo();
  writePackageJson(repoRoot, {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
    './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
    './observability': { types: './dist/observability.d.ts', default: './dist/observability.js' },
  });
  writeFile(repoRoot, 'README.md', '`@idenstra/messaging-runtime/dist/core`\n');
  writeFile(repoRoot, 'src/index.ts', "export * from '@idenstra/messaging-runtime/src/core';\n");
  writeFile(repoRoot, 'scripts/example.mjs', "await import('@idenstra/messaging-runtime/transport');\n");

  const findings = findPublicImportSurfaceFindings(repoRoot, ['README.md', 'src/index.ts', 'scripts/example.mjs']);

  assert.deepEqual(
    findings.map((finding) => finding.specifier),
    [
      '@idenstra/messaging-runtime/dist/core',
      '@idenstra/messaging-runtime/src/core',
      '@idenstra/messaging-runtime/transport',
    ],
  );
});

test('findPackageExportFindings rejects unsupported public subpaths', () => {
  const repoRoot = createTempRepo();
  writePackageJson(repoRoot, {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
    './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
    './observability': { types: './dist/observability.d.ts', default: './dist/observability.js' },
    './transport': { types: './dist/transport.d.ts', default: './dist/transport.js' },
  });

  const findings = findPackageExportFindings(repoRoot);

  assert.deepEqual(findings, [
    {
      code: 'unsupported-export-subpaths',
      path: 'package.json',
      message: 'package exports must stay exactly ., ./core, ./nest, ./observability',
      actualExportKeys: ['.', './core', './nest', './observability', './transport'],
      expectedExportKeys: ['.', './core', './nest', './observability'],
    },
  ]);
});

test('findPublicImportSurfaceFindings ignores the validator self-fixtures', () => {
  const repoRoot = createTempRepo();
  writePackageJson(repoRoot, {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './core': { types: './dist/core/index.d.ts', default: './dist/core/index.js' },
    './nest': { types: './dist/adapters/nest.d.ts', default: './dist/adapters/nest.js' },
    './observability': { types: './dist/observability.d.ts', default: './dist/observability.js' },
  });
  writeFile(
    repoRoot,
    'scripts/harness/check-public-import-surface.test.mjs',
    "'@idenstra/messaging-runtime/dist/core'\n",
  );

  const findings = findPublicImportSurfaceFindings(repoRoot, ['scripts/harness/check-public-import-surface.test.mjs']);

  assert.deepEqual(findings, []);
});
