import { createRPCController } from '@shared/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { getTerminalsForTask } from './getTerminalsForTask';
import { getTerminalShellAvailability } from './getTerminalShellAvailability';
import { hydrateTerminal } from './hydrateTerminal';
import { stopLifecycleScriptSession } from './lifecycle-script-coordinator';
import { prepareLifecycleScript } from './prepareLifecycleScript';
import { renameTerminal } from './renameTerminal';
import { runLifecycleScript } from './runLifecycleScript';
import { stopDevServers } from './stopDevServers';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  getTerminalShellAvailability,
  hydrateTerminal,
  prepareLifecycleScript,
  renameTerminal,
  getTerminalsForTask,
  runLifecycleScript,
  stopDevServers,
  stopLifecycleScript: (args: {
    projectId: string;
    taskId: string;
    workspaceId: string;
    type: 'setup' | 'run' | 'teardown';
  }) => {
    stopLifecycleScriptSession({ ...args, origin: 'manual' });
  },
});
