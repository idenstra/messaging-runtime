import type { BenchmarkScenario } from '../support';
import { getPreparedSnapshotManager, manyRouteCount } from './fixtures';

export function createSnapshotBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    {
      name: 'snapshot:many-routes',
      description: 'Snapshot aggregation and cloning cost with many registered routes.',
      iterationsPerSample: 5_000,
      async runIteration() {
        const manager = await getPreparedSnapshotManager();
        const snapshot = manager.getSnapshot();

        if (snapshot.routeCount !== manyRouteCount) {
          throw new Error(
            `Expected ${manyRouteCount} routes in prepared snapshot fixture, observed ${snapshot.routeCount}.`,
          );
        }
      },
    },
  ];
}
