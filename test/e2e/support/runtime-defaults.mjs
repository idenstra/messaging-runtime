export function createStandardRuntimeDefaults(overrides = {}) {
  return { waitTimeSeconds: 0, emptyReceiveDelayMs: 0, heartbeatIntervalMs: 0, errorBackoffMs: 0, ...overrides };
}
