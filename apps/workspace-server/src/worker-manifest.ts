import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import workspaceWorkers from './worker-manifest.json' with { type: 'json' };

export type WorkspaceWorkerId = keyof typeof workspaceWorkers;

export function workspaceWorkerPath(id: WorkspaceWorkerId): string {
  return fileURLToPath(new URL(`./${workspaceWorkers[id].file}`, import.meta.url));
}

export function workspaceWorkerBuildInputs(): Record<string, string> {
  return Object.fromEntries(
    Object.values(workspaceWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      worker.entry,
    ])
  );
}
