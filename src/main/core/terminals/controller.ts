import { createRPCController } from '@shared/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { getTerminalsForTask } from './getTerminalsForTask';
import { renameTerminal } from './renameTerminal';
import { runLifecycleScript } from './runLifecycleScript';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  renameTerminal,
  getTerminalsForTask,
  runLifecycleScript,
});
