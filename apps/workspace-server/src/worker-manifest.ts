import { fileURLToPath } from 'node:url';
import { acpWorker } from '../../../packages/core/src/runtimes/acp/api/worker';
import { agentConfigWorker } from '../../../packages/core/src/runtimes/agent-config/api/worker';
import { automationsWorker } from '../../../packages/core/src/runtimes/automations/api/worker';
import { fileSearchWorker } from '../../../packages/core/src/runtimes/file-search/api/worker';
import { filesWorker } from '../../../packages/core/src/runtimes/files/api/worker';
import { gitWorker } from '../../../packages/core/src/runtimes/git/api/worker';
import { terminalsWorker } from '../../../packages/core/src/runtimes/terminals/api/worker';
import { tuiAgentsWorker } from '../../../packages/core/src/runtimes/tui-agents/api/worker';
import { workspaceWorker } from '../../../packages/core/src/runtimes/workspace/api/worker';
import { fsWatchWorker } from '../../../packages/core/src/services/fs-watch/api/worker';
import { workspaceWorkerBuildInputs as buildWorkspaceWorkerInputs } from '../worker-manifest-utils.js';

function workspaceRuntimeWorker<const Id extends string>(
  worker: Readonly<{ id: Id; artifact: string }>,
  entry: string
) {
  return {
    entry,
    file: `${worker.artifact}.mjs`,
  } as const;
}

export const workspaceWorkers = {
  [acpWorker.id]: workspaceRuntimeWorker(acpWorker, 'src/acp/runtime-entry.ts'),
  [agentConfigWorker.id]: workspaceRuntimeWorker(
    agentConfigWorker,
    'src/agent-config/runtime-entry.ts'
  ),
  [automationsWorker.id]: workspaceRuntimeWorker(
    automationsWorker,
    'src/automations/runtime-entry.ts'
  ),
  [fileSearchWorker.id]: workspaceRuntimeWorker(
    fileSearchWorker,
    'src/file-search/runtime-entry.ts'
  ),
  [filesWorker.id]: workspaceRuntimeWorker(filesWorker, 'src/files/runtime-entry.ts'),
  [fsWatchWorker.id]: workspaceRuntimeWorker(fsWatchWorker, 'src/fs-watch/runtime-entry.ts'),
  [gitWorker.id]: workspaceRuntimeWorker(gitWorker, 'src/git/runtime-entry.ts'),
  [terminalsWorker.id]: workspaceRuntimeWorker(terminalsWorker, 'src/terminals/runtime-entry.ts'),
  [tuiAgentsWorker.id]: workspaceRuntimeWorker(tuiAgentsWorker, 'src/tui-agents/runtime-entry.ts'),
  [workspaceWorker.id]: workspaceRuntimeWorker(workspaceWorker, 'src/workspace/runtime-entry.ts'),
} as const;

export type WorkspaceWorkerId = keyof typeof workspaceWorkers;

export function workspaceWorkerPath(id: WorkspaceWorkerId): string {
  return fileURLToPath(new URL(`./${workspaceWorkers[id].file}`, import.meta.url));
}

export function workspaceWorkerBuildInputs(): Record<string, string> {
  return buildWorkspaceWorkerInputs(workspaceWorkers);
}
