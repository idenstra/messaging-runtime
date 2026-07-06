export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(
  check,
  { timeoutMs = 10_000, intervalMs = 200, description = 'condition' } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`,
  );
}
