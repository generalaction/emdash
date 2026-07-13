import { basename, extname } from 'node:path';

export function workspaceWorkerBuildInputs(workspaceWorkers) {
  return Object.fromEntries(
    Object.values(workspaceWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      worker.entry,
    ])
  );
}
