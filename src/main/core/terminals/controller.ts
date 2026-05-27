import { createRPCController } from '@shared/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { getTerminalsForTask } from './getTerminalsForTask';
import { hydrateTerminal } from './hydrateTerminal';
import { prepareLifecycleScript } from './prepareLifecycleScript';
import { renameTerminal } from './renameTerminal';
import { runLifecycleScript } from './runLifecycleScript';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  hydrateTerminal,
  prepareLifecycleScript,
  renameTerminal,
  getTerminalsForTask,
  runLifecycleScript,
});
