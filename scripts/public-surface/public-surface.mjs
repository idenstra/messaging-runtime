export const packageName = '@idenstra/messaging-runtime';

export const publicEntrypoints = [
  {
    id: 'root',
    exportKey: '.',
    importSpecifier: '@idenstra/messaging-runtime',
    declarationPath: 'dist/index.d.ts',
    reportConfigPath: 'public-surface-report.root.json',
    reportPath: 'etc/messaging-runtime.public-surface.api.md',
  },
  {
    id: 'core',
    exportKey: './core',
    importSpecifier: '@idenstra/messaging-runtime/core',
    declarationPath: 'dist/core.d.ts',
    reportConfigPath: 'public-surface-report.core.json',
    reportPath: 'etc/messaging-runtime-core.public-surface.api.md',
  },
  {
    id: 'nest',
    exportKey: './nest',
    importSpecifier: '@idenstra/messaging-runtime/nest',
    declarationPath: 'dist/adapters/nest.d.ts',
    reportConfigPath: 'public-surface-report.nest.json',
    reportPath: 'etc/messaging-runtime-nest.public-surface.api.md',
  },
  {
    id: 'observability',
    exportKey: './observability',
    importSpecifier: '@idenstra/messaging-runtime/observability',
    declarationPath: 'dist/observability.d.ts',
    reportConfigPath: 'public-surface-report.observability.json',
    reportPath: 'etc/messaging-runtime-observability.public-surface.api.md',
  },
];

export const supportedPublicImportSpecifiers = publicEntrypoints.map((entrypoint) => entrypoint.importSpecifier);
export const supportedPublicExportKeys = publicEntrypoints.map((entrypoint) => entrypoint.exportKey);

export function getPublicEntrypointByExportKey(exportKey) {
  return publicEntrypoints.find((entrypoint) => entrypoint.exportKey === exportKey);
}
