import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function relativeUnix(root, filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

export function walkFiles(dir, predicate = defaultPredicate) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function listTrackedFiles(root) {
  const output = childProcess.execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultPredicate(filePath) {
  return filePath.endsWith('.md');
}
