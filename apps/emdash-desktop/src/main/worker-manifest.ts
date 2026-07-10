import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopWorkers = {
  acp: {
    entry: 'src/main/core/acp/runtime-process/entry.ts',
    file: 'acp-runtime.js',
  },
  'agent-config': {
    entry: 'src/main/core/agent-config/runtime-process/entry.ts',
    file: 'agent-config-runtime.js',
  },
  'fs-watch': {
    entry: 'src/main/core/fs-watch/runtime-process/entry.ts',
    file: 'fs-watch-runtime.js',
  },
} as const;

export type DesktopWorkerId = keyof typeof desktopWorkers;

export function desktopWorkerPath(id: DesktopWorkerId): string {
  return fileURLToPath(new URL(`./${desktopWorkers[id].file}`, import.meta.url));
}

export function desktopWorkerBuildInputs(): Record<string, string> {
  return Object.fromEntries(
    Object.values(desktopWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      resolve(worker.entry),
    ])
  );
}
