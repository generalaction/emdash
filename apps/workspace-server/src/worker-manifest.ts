import { fileURLToPath } from 'node:url';
import { workspaceWorkerBuildInputs as buildWorkspaceWorkerInputs } from '../worker-manifest-utils.js';
import workspaceWorkers from './worker-manifest.json' with { type: 'json' };

export type WorkspaceWorkerId = keyof typeof workspaceWorkers;

export function workspaceWorkerPath(id: WorkspaceWorkerId): string {
  return fileURLToPath(new URL(`./${workspaceWorkers[id].file}`, import.meta.url));
}

export function workspaceWorkerBuildInputs(): Record<string, string> {
  return buildWorkspaceWorkerInputs(workspaceWorkers);
}
