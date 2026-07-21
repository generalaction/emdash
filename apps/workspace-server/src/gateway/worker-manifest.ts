import { basename, extname } from 'node:path';
import { acpWorker } from '../../../../packages/core/src/runtimes/acp/api/worker';
import { agentConfigWorker } from '../../../../packages/core/src/runtimes/agent-config/api/worker';
import { automationsWorker } from '../../../../packages/core/src/runtimes/automations/api/worker';
import { fileSearchWorker } from '../../../../packages/core/src/runtimes/file-search/api/worker';
import { filesWorker } from '../../../../packages/core/src/runtimes/files/api/worker';
import { gitWorker } from '../../../../packages/core/src/runtimes/git/api/worker';
import { resourceUsageWorker } from '../../../../packages/core/src/runtimes/resource-usage/api/worker';
import { terminalsWorker } from '../../../../packages/core/src/runtimes/terminals/api/worker';
import { tuiAgentsWorker } from '../../../../packages/core/src/runtimes/tui-agents/api/worker';
import { workspaceWorker } from '../../../../packages/core/src/runtimes/workspace/api/worker';
import { fsWatchWorker } from '../../../../packages/core/src/services/fs-watch/api/worker';

function workspaceRuntimeWorker<const Id extends string>(
  worker: Readonly<{ id: Id; artifact: string }>,
  entry: string
) {
  return {
    id: worker.id,
    entry,
    file: `${worker.artifact}.mjs`,
  } as const;
}

export const workspaceWorkers = {
  [acpWorker.id]: workspaceRuntimeWorker(acpWorker, 'src/gateway/entries/acp.ts'),
  [automationsWorker.id]: workspaceRuntimeWorker(
    automationsWorker,
    '../../packages/core/src/runtimes/automations/node/runtime-entry.ts'
  ),
  [agentConfigWorker.id]: workspaceRuntimeWorker(
    agentConfigWorker,
    'src/gateway/entries/agent-config.ts'
  ),
  [fsWatchWorker.id]: workspaceRuntimeWorker(
    fsWatchWorker,
    '../../packages/core/src/services/fs-watch/node/runtime-entry.ts'
  ),
  [fileSearchWorker.id]: workspaceRuntimeWorker(
    fileSearchWorker,
    '../../packages/core/src/runtimes/file-search/node/runtime-entry.ts'
  ),
  [filesWorker.id]: workspaceRuntimeWorker(
    filesWorker,
    '../../packages/core/src/runtimes/files/node/runtime-entry.ts'
  ),
  [gitWorker.id]: workspaceRuntimeWorker(
    gitWorker,
    '../../packages/core/src/runtimes/git/node/runtime-entry.ts'
  ),
  [resourceUsageWorker.id]: workspaceRuntimeWorker(
    resourceUsageWorker,
    '../../packages/core/src/runtimes/resource-usage/node/runtime-entry.ts'
  ),
  [terminalsWorker.id]: workspaceRuntimeWorker(
    terminalsWorker,
    '../../packages/core/src/runtimes/terminals/node/runtime-entry.ts'
  ),
  [tuiAgentsWorker.id]: workspaceRuntimeWorker(
    tuiAgentsWorker,
    'src/gateway/entries/tui-agents.ts'
  ),
  [workspaceWorker.id]: workspaceRuntimeWorker(
    workspaceWorker,
    '../../packages/core/src/runtimes/workspace/node/runtime-entry.ts'
  ),
} as const;

export type WorkspaceWorkerId = keyof typeof workspaceWorkers;

export function workspaceWorkerBuildInputs(): Record<string, string> {
  return Object.fromEntries(
    Object.values(workspaceWorkers).map((worker) => [
      basename(worker.file, extname(worker.file)),
      worker.entry,
    ])
  );
}
