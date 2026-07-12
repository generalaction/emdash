import { gitContract, type GitContract } from '@emdash/core/git';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { lazyWorker, type WorkerHandle } from '@emdash/wire/worker';
import { ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { NON_INTERACTIVE_GIT_ENV } from '@main/core/execution-context/non-interactive-git-env';
import { getGitExecutable } from '@main/core/utils/exec';
import { desktopWorkerPath } from '@main/worker-manifest';
import { GIT_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

const gitRuntimeScope = appScope.child('git-runtime-host');
const gitWorker = lazyWorker(
  () => ({
    name: 'git',
    contract: gitContract,
    entry: desktopWorkerPath('git'),
    scope: gitRuntimeScope,
    env: {
      ...process.env,
      ...NON_INTERACTIVE_GIT_ENV,
      EMDASH_GIT_EXECUTABLE: getGitExecutable(),
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
    },
  }),
  { onSpawned: (handle) => installRendererWire(handle.client) }
);

export type GitRuntimeClient = ContractClient<GitContract>;
export type GitRuntimeHandle = WorkerHandle<GitContract>;

let rendererWireDispose: (() => void) | null = null;

export function initializeGitRuntimeProcess(): Promise<GitRuntimeHandle> {
  return gitWorker.get();
}

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  return (await initializeGitRuntimeProcess()).client;
}

export async function disposeGitRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  await gitWorker.dispose();
}

function installRendererWire(client: GitRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    gitContract,
    forwardController(gitContract, client),
    import.meta.env.DEV ? 'full' : 'inputs'
  );
  rendererWireDispose = exposeWireToWindows(
    {
      ipcMain,
      createMessageChannel: () => {
        const channel = new MessageChannelMain();
        return { port1: channel.port1, port2: channel.port2 };
      },
    },
    controller,
    { channel: GIT_WIRE_CHANNEL }
  );
}
