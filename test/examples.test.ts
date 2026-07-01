import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('queue-ops example script type-checks against the supported public imports', () => {
  const repoRoot = process.cwd();
  const tscBinary = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

  assert.doesNotThrow(() => {
    childProcess.execFileSync(tscBinary, ['-p', 'examples/tsconfig.json', '--noEmit'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  });
});
