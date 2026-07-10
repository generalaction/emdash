import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveWorkerEntry(name: string, dir: string): string {
  const candidates = [join(dir, `${name}-runtime.js`), join(dir, `${name}-runtime.mjs`)];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      `${formatWorkerName(name)} worker process entry is missing. Checked: ${candidates.join(', ')}`
    );
  }
  return entry;
}

function formatWorkerName(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}
