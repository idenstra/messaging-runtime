export const packageMetadata = {
  name: '@idenstra/messaging-runtime',
  phase: 'runtime-core-transport-and-host',
} as const;

export * from './core';
export * from './host';
export * from './transport';
