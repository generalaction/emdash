import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopWorkers = {
  acp: {
    entry: 'src/main/core/wire-workers/entries/acp.ts',
    file: 'acp-runtime.js',
  },
  'agent-config': {
    entry: 'src/main/core/wire-workers/entries/agent-config.ts',
    file: 'agent-config-runtime.js',
  },
  'fs-watch': {
    entry: 'src/main/core/wire-workers/entries/fs-watch.ts',
    file: 'fs-watch-runtime.js',
  },
  files: {
    entry: 'src/main/core/wire-workers/entries/files.ts',
    file: 'files-runtime.js',
  },
  git: {
    entry: 'src/main/core/wire-workers/entries/git.ts',
    file: 'git-runtime.js',
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
