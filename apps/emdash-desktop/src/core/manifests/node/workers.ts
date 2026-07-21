import { acpWorker } from '../../../../../../packages/core/src/runtimes/acp/api/worker';
import { agentConfigWorker } from '../../../../../../packages/core/src/runtimes/agent-config/api/worker';
import { automationsWorker } from '../../../../../../packages/core/src/runtimes/automations/api/worker';
import { fileSearchWorker } from '../../../../../../packages/core/src/runtimes/file-search/api/worker';
import { filesWorker } from '../../../../../../packages/core/src/runtimes/files/api/worker';
import { gitWorker } from '../../../../../../packages/core/src/runtimes/git/api/worker';
import { resourceUsageWorker } from '../../../../../../packages/core/src/runtimes/resource-usage/api/worker';
import { terminalsWorker } from '../../../../../../packages/core/src/runtimes/terminals/api/worker';
import { tuiAgentsWorker } from '../../../../../../packages/core/src/runtimes/tui-agents/api/worker';
import { workspaceWorker } from '../../../../../../packages/core/src/runtimes/workspace/api/worker';
import { fsWatchWorker } from '../../../../../../packages/core/src/services/fs-watch/api/worker';
import { mementosWorker } from '../../services/mementos/contributions/worker';
import { pullRequestsWorker } from '../../services/pull-requests/contributions/worker';

function desktopRuntimeWorker<const Id extends string>(
  worker: Readonly<{ id: Id; artifact: string }>,
  entry: string
) {
  return {
    id: worker.id,
    entry,
    file: `${worker.artifact}.js`,
  } as const;
}

export const desktopWorkers = {
  [acpWorker.id]: desktopRuntimeWorker(acpWorker, 'src/main/gateway/entries/acp.ts'),
  [automationsWorker.id]: desktopRuntimeWorker(
    automationsWorker,
    '../../packages/core/src/runtimes/automations/node/runtime-entry.ts'
  ),
  [agentConfigWorker.id]: desktopRuntimeWorker(
    agentConfigWorker,
    'src/main/gateway/entries/agent-config.ts'
  ),
  [fsWatchWorker.id]: desktopRuntimeWorker(
    fsWatchWorker,
    '../../packages/core/src/services/fs-watch/node/runtime-entry.ts'
  ),
  [fileSearchWorker.id]: desktopRuntimeWorker(
    fileSearchWorker,
    '../../packages/core/src/runtimes/file-search/node/runtime-entry.ts'
  ),
  [filesWorker.id]: desktopRuntimeWorker(
    filesWorker,
    '../../packages/core/src/runtimes/files/node/runtime-entry.ts'
  ),
  [gitWorker.id]: desktopRuntimeWorker(
    gitWorker,
    '../../packages/core/src/runtimes/git/node/runtime-entry.ts'
  ),
  [mementosWorker.id]: mementosWorker,
  [pullRequestsWorker.id]: pullRequestsWorker,
  [resourceUsageWorker.id]: desktopRuntimeWorker(
    resourceUsageWorker,
    '../../packages/core/src/runtimes/resource-usage/node/runtime-entry.ts'
  ),
  [terminalsWorker.id]: desktopRuntimeWorker(
    terminalsWorker,
    '../../packages/core/src/runtimes/terminals/node/runtime-entry.ts'
  ),
  [tuiAgentsWorker.id]: desktopRuntimeWorker(
    tuiAgentsWorker,
    'src/main/gateway/entries/tui-agents.ts'
  ),
  [workspaceWorker.id]: desktopRuntimeWorker(
    workspaceWorker,
    '../../packages/core/src/runtimes/workspace/node/runtime-entry.ts'
  ),
} as const;

export type DesktopWorkerId = keyof typeof desktopWorkers;
