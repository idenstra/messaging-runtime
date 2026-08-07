import type { BenchmarkScenario } from '../support';
import { createDecodeBenchmarkScenarios } from './decode';
import { createPublisherBenchmarkScenarios } from './publishers';
import { createResolverBenchmarkScenarios } from './resolvers';
import { createSnapshotBenchmarkScenarios } from './snapshot';
import { createWorkerBenchmarkScenarios } from './worker';

export function createBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    ...createDecodeBenchmarkScenarios(),
    ...createPublisherBenchmarkScenarios(),
    ...createResolverBenchmarkScenarios(),
    ...createWorkerBenchmarkScenarios(),
    ...createSnapshotBenchmarkScenarios(),
  ];
}
