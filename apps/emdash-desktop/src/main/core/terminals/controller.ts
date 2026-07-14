import { createRPCController } from '@shared/lib/ipc/rpc';
import { createTerminal } from './createTerminal';
import { deleteTerminal } from './deleteTerminal';
import { getAllTerminals } from './getAllTerminals';
import { getTerminalsForTask } from './getTerminalsForTask';
import { getTerminalShellAvailability } from './getTerminalShellAvailability';
import { hydrateTerminal } from './hydrateTerminal';
import { renameTerminal } from './renameTerminal';

export const terminalsController = createRPCController({
  getAllTerminals,
  createTerminal,
  deleteTerminal,
  getTerminalShellAvailability,
  hydrateTerminal,
  renameTerminal,
  getTerminalsForTask,
});
